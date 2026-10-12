package documents

import (
	"context"
	"errors"
	"regexp"
	"slices"
	"strings"
	"time"

	"bizzy-lambda/internal/features/clients"
	"bizzy-lambda/internal/features/docref"
	"bizzy-lambda/internal/features/packages"
	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/features/settings"
	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/platform/dynamo"
	"bizzy-lambda/internal/router"
)

type store interface {
	Get(ctx context.Context, id string) (Document, bool, error)
	ListByMonth(ctx context.Context, docType Type, month string) ([]Document, error)
	ListByClient(ctx context.Context, clientID string) ([]Document, error)
	SharedID(ctx context.Context, token string) (string, bool, error)
	Revisions(ctx context.Context, id string) ([]Revision, error)
	Counter(ctx context.Context, key string) (int64, error)
	Commit(ctx context.Context, w Write) error
}

type Deps struct {
	Repo     store
	Sessions interface {
		Get(ctx context.Context, eventID string) (sessions.Session, bool, error)
	}
	Packages interface {
		Get(ctx context.Context, id string) (packages.Package, bool, error)
	}
	Clients interface {
		Get(ctx context.Context, id string) (clients.Client, bool, error)
	}
	Settings interface {
		Get(ctx context.Context) (settings.Settings, error)
	}
	// AfterChange reconciles the clients whose sessions or packages a
	// document now covers differently (amounts, drift).
	AfterChange func(ctx context.Context, clientIDs ...string) error
	Location    *time.Location
	Now         func() time.Time
}

type handler struct{ Deps }

func Register(r *router.Router, deps Deps) {
	h := handler{deps}
	r.Register("documents.list", router.Typed(h.list))
	r.Register("documents.listByClient", router.Typed(h.listByClient))
	r.Register("documents.get", router.Typed(h.get))
	r.Register("documents.createDraft", router.Typed(h.createDraft))
	r.Register("documents.saveDraft", router.Typed(h.saveDraft))
	r.Register("documents.issue", router.Typed(h.issue))
	r.Register("documents.revise", router.Typed(h.revise))
	r.Register("documents.discardDraft", router.Typed(h.discardDraft))
	r.Register("documents.cancel", router.Typed(h.cancel))
	r.Register("documents.share", router.Typed(h.share))
	r.Register("documents.resetShare", router.Typed(h.resetShare))
}

type typeInput struct {
	Type Type `json:"type"`
}

func (in typeInput) spec() (TypeSpec, error) {
	spec, ok := Types[in.Type]
	if !ok {
		return spec, apperr.Invalid("unknown document type %q", in.Type)
	}
	return spec, nil
}

type listInput struct {
	Type Type `json:"type"`
	// Month is "2026-10": a list covers one month of document dates, so it
	// stays small however many years of documents there are.
	Month string `json:"month"`
}

var monthPattern = regexp.MustCompile(`^\d{4}-(0[1-9]|1[0-2])$`)

// list returns one month of one type of document, newest first, as summaries:
// a list needs no printed content, which is most of a document's size.
func (h handler) list(ctx context.Context, in listInput) (any, error) {
	if _, err := (typeInput{Type: in.Type}).spec(); err != nil {
		return nil, err
	}
	if !monthPattern.MatchString(in.Month) {
		return nil, apperr.Invalid("choose a month like 2026-10")
	}
	docs, err := h.Repo.ListByMonth(ctx, in.Type, in.Month)
	if err != nil {
		return nil, err
	}
	return summaries(docs), nil
}

type clientInput struct {
	ClientID string `json:"clientId"`
}

// listByClient returns a client's documents of every type, newest first.
func (h handler) listByClient(ctx context.Context, in clientInput) (any, error) {
	if in.ClientID == "" {
		return nil, apperr.Invalid("choose a client")
	}
	docs, err := h.Repo.ListByClient(ctx, in.ClientID)
	if err != nil {
		return nil, err
	}
	return summaries(docs), nil
}

func summaries(docs []Document) []Summary {
	out := make([]Summary, len(docs))
	for i, d := range docs {
		out[i] = d.Summary()
	}
	return out
}

type idInput struct {
	ID string `json:"id"`
	// Version is the one she was looking at, so a stale tab can't overwrite.
	Version int `json:"version"`
}

type getOutput struct {
	Document  Document   `json:"document"`
	Revisions []Revision `json:"revisions"`
}

func (h handler) get(ctx context.Context, in idInput) (any, error) {
	doc, err := h.load(ctx, in.ID, 0)
	if err != nil {
		return nil, err
	}
	revisions, err := h.Repo.Revisions(ctx, in.ID)
	if err != nil {
		return nil, err
	}
	return getOutput{Document: doc, Revisions: revisions}, nil
}

type createDraftInput struct {
	Type Type `json:"type"`
	// Sources are what the document covers, all for one client: usually one
	// session, or a session and the package its title bought.
	Sources []Source `json:"sources"`
}

// paidBy is how a receipt says what it covers was paid, from what she
// recorded on the sessions.
func paidBy(payments []*sessions.Payment) string {
	seen := map[string]bool{}
	var labels []string
	for _, p := range payments {
		if p == nil || p.Status != sessions.PaymentPaid {
			continue
		}
		label := sessions.MethodLabels[p.Method]
		if !seen[label] {
			seen[label] = true
			labels = append(labels, label)
		}
	}
	return strings.Join(labels, ", ")
}

// createDraft starts a document from sessions and packages and reserves
// them, so none can end up on two documents of the type.
func (h handler) createDraft(ctx context.Context, in createDraftInput) (any, error) {
	spec, err := (typeInput{Type: in.Type}).spec()
	if err != nil {
		return nil, err
	}
	sources := uniqueSources(in.Sources)
	if len(sources) == 0 {
		return nil, apperr.Invalid("choose what the document covers")
	}
	cfg, err := h.Settings.Get(ctx)
	if err != nil {
		return nil, err
	}
	now := h.Now().UTC()
	today := now.In(h.Location).Format(time.DateOnly)
	ref := docref.Ref{DocumentID: dynamo.NewID()}

	var lines []Line
	var links []dynamo.Patch
	var payments []*sessions.Payment
	clientID := ""

	for _, src := range sources {
		line, owner, payment, err := h.sourceLine(ctx, src, spec, cfg)
		if err != nil {
			return nil, err
		}
		if clientID != "" && owner != clientID {
			return nil, apperr.Invalid("one document covers one client")
		}
		clientID = owner

		link, err := linkPatch(src, spec.Slot, ref)
		if err != nil {
			return nil, err
		}
		lines, links, payments = append(lines, line), append(links, link), append(payments, payment)
	}

	client, err := h.client(ctx, clientID)
	if err != nil {
		return nil, err
	}
	draft := NewContent(cfg, client, today, lines)
	if in.Type == TypeReceipt {
		draft.PaidBy = paidBy(payments)
	}
	content, err := Normalize(draft, sourceSet(sources))
	if err != nil {
		return nil, err
	}

	doc := Document{
		ID:         ref.DocumentID,
		Type:       in.Type,
		Status:     StatusDraft,
		ClientID:   clientID,
		Date:       content.Date,
		TotalCents: content.TotalCents,
		Sources:    sources,
		Draft:      &content,
		CreatedAt:  now,
		Version:    1,
	}
	if err := h.commit(ctx, Write{Doc: doc, Links: links}); err != nil {
		return nil, err
	}
	return doc, nil
}

type saveDraftInput struct {
	ID      string  `json:"id"`
	Version int     `json:"version"`
	Content Content `json:"content"`
}

func (h handler) saveDraft(ctx context.Context, in saveDraftInput) (any, error) {
	doc, err := h.load(ctx, in.ID, in.Version)
	if err != nil {
		return nil, err
	}
	if doc.Draft == nil {
		return nil, apperr.Conflict("this document is not being edited")
	}

	content, err := Normalize(in.Content, sourceSet(doc.Sources))
	if err != nil {
		return nil, err
	}

	updated := doc
	updated.Draft = &content
	if updated.Status == StatusDraft {
		updated.Date, updated.TotalCents = content.Date, content.TotalCents
	}
	updated.Version++

	if err := h.commit(ctx, Write{Doc: updated, PreviousVersion: doc.Version}); err != nil {
		return nil, err
	}
	return updated, nil
}

// issue makes the draft final: the first time it takes a number (rev 0),
// afterwards it becomes the next revision under the same number.
func (h handler) issue(ctx context.Context, in idInput) (any, error) {
	// A conflict on the counter means another document took the number
	// first; read it again and retry.
	for attempt := 0; ; attempt++ {
		doc, err := h.load(ctx, in.ID, in.Version)
		if err != nil {
			return nil, err
		}
		if doc.Draft == nil {
			return nil, apperr.Conflict("there is nothing to issue")
		}

		updated, w, err := h.prepareIssue(ctx, doc)
		if err != nil {
			return nil, err
		}
		err = h.Repo.Commit(ctx, w)
		if errors.Is(err, dynamo.ErrTransactionConflict) && w.Counter != nil && attempt < 3 {
			continue
		}
		if err := conflictErr(err); err != nil {
			return nil, err
		}

		if err := h.afterChange(ctx, doc, updated); err != nil {
			return nil, err
		}
		return updated, nil
	}
}

func (h handler) prepareIssue(ctx context.Context, doc Document) (Document, Write, error) {
	now := h.Now().UTC()
	content := *doc.Draft
	spec := Types[doc.Type]

	updated := doc
	w := Write{PreviousVersion: doc.Version}

	if doc.Number == "" {
		issued := now.In(h.Location)
		key := counterKey(doc.Type, issued)
		last, err := h.Repo.Counter(ctx, key)
		if err != nil {
			return doc, w, err
		}
		updated.Number = Number(spec, issued.Year(), last+1)
		updated.Revision = new(int)
		updated.IssuedAt = &now
		w.Counter = &CounterBump{Key: key, Prev: last, Next: last + 1}
	} else {
		next := *doc.Revision + 1
		updated.Revision = &next
	}
	// Ready to send the moment it is issued.
	if doc.ShareToken == "" {
		updated.ShareToken = newShareToken()
		w.Share = &ShareChange{New: updated.ShareToken}
	}

	updated.Status = StatusIssued
	updated.Content = &content
	updated.Draft = nil
	updated.Date, updated.TotalCents = content.Date, content.TotalCents
	updated.Version++

	// Point every source still on the document at it, with the amount and
	// date it now says; release any whose line she removed.
	amounts := sourceAmounts(content)
	var kept []Source
	for _, src := range doc.Sources {
		amount, ok := amounts[src]
		if !ok {
			w.Links = append(w.Links, unlinkPatch(src, spec.Slot, doc.ID))
			continue
		}
		kept = append(kept, src)
		ref := docref.Ref{
			DocumentID:  doc.ID,
			Number:      updated.Number,
			Revision:    *updated.Revision,
			AmountCents: &amount,
			Date:        lineDate(content, src),
			ClientID:    doc.ClientID,
		}
		link, err := linkPatch(src, spec.Slot, ref)
		if err != nil {
			return doc, w, err
		}
		w.Links = append(w.Links, link)
	}
	if kept == nil {
		kept = []Source{}
	}
	updated.Sources = kept

	w.Doc = updated
	w.Revision = &Revision{
		DocumentID: doc.ID,
		Revision:   *updated.Revision,
		Number:     updated.Number,
		Content:    content,
		IssuedAt:   now,
	}
	return updated, w, nil
}

// revise opens an issued document for editing again. The issued revision
// stays the valid one until the new draft is issued.
func (h handler) revise(ctx context.Context, in idInput) (any, error) {
	doc, err := h.load(ctx, in.ID, in.Version)
	if err != nil {
		return nil, err
	}
	if doc.Status != StatusIssued || doc.Draft != nil {
		return nil, apperr.Conflict("only an issued document can be revised")
	}

	updated := doc
	draft := *doc.Content
	draft.Lines = slices.Clone(doc.Content.Lines)
	updated.Draft = &draft
	updated.Version++

	if err := h.commit(ctx, Write{Doc: updated, PreviousVersion: doc.Version}); err != nil {
		return nil, err
	}
	return updated, nil
}

// discardDraft throws a draft away: a never-issued document disappears (it
// had no number) and releases what it covered; a revision in progress just
// goes back to the issued one.
func (h handler) discardDraft(ctx context.Context, in idInput) (any, error) {
	doc, err := h.load(ctx, in.ID, in.Version)
	if err != nil {
		return nil, err
	}
	if doc.Draft == nil {
		return nil, apperr.Conflict("there is no draft to discard")
	}

	if doc.Number == "" {
		w := Write{Doc: doc, PreviousVersion: doc.Version, Delete: true}
		for _, src := range doc.Sources {
			w.Links = append(w.Links, unlinkPatch(src, Types[doc.Type].Slot, doc.ID))
		}
		if err := h.commit(ctx, w); err != nil {
			return nil, err
		}
		// A session kept only because the draft held it can now go.
		return nil, h.afterChange(ctx, doc, doc)
	}

	updated := doc
	updated.Draft = nil
	updated.Version++
	if err := h.commit(ctx, Write{Doc: updated, PreviousVersion: doc.Version}); err != nil {
		return nil, err
	}
	return updated, nil
}

type cancelInput struct {
	ID      string `json:"id"`
	Version int    `json:"version"`
	Reason  string `json:"reason"`
}

// cancel voids an issued document. Its number stays used and its revisions
// are kept; what it covered is released.
func (h handler) cancel(ctx context.Context, in cancelInput) (any, error) {
	doc, err := h.load(ctx, in.ID, in.Version)
	if err != nil {
		return nil, err
	}
	if doc.Status != StatusIssued {
		return nil, apperr.Conflict("only an issued document can be cancelled; discard a draft instead")
	}

	now := h.Now().UTC()
	updated := doc
	updated.Status = StatusCancelled
	updated.Draft = nil
	updated.CancelledAt = &now
	updated.CancelReason = in.Reason
	updated.Version++

	w := Write{Doc: updated, PreviousVersion: doc.Version}
	for _, src := range doc.Sources {
		w.Links = append(w.Links, unlinkPatch(src, Types[doc.Type].Slot, doc.ID))
	}
	if err := h.commit(ctx, w); err != nil {
		return nil, err
	}
	if err := h.afterChange(ctx, doc, updated); err != nil {
		return nil, err
	}
	return updated, nil
}

func (h handler) load(ctx context.Context, id string, version int) (Document, error) {
	doc, found, err := h.Repo.Get(ctx, id)
	if err != nil {
		return doc, err
	}
	if !found {
		return doc, apperr.NotFound("document not found")
	}
	if version != 0 && doc.Version != version {
		return doc, apperr.Conflict("this document changed elsewhere; reload it")
	}
	return doc, nil
}

// sourceLine checks a source can go on a document of the type and prefills
// its line. It returns the client the source belongs to and, for a session
// or a package bought in one, what she recorded as paid.
func (h handler) sourceLine(ctx context.Context, src Source, spec TypeSpec, cfg settings.Settings) (Line, string, *sessions.Payment, error) {
	switch src.Kind {
	case SourceSession:
		s, found, err := h.Sessions.Get(ctx, src.ID)
		if err != nil {
			return Line{}, "", nil, err
		}
		if !found {
			return Line{}, "", nil, apperr.NotFound("session not found")
		}
		switch {
		case spec.Slot == docref.SlotInvoice && !s.CanInvoice():
			return Line{}, "", nil, apperr.Conflict("only a confirmed session with a fee and no invoice yet can get one")
		case spec.Slot == docref.SlotReceipt && !s.CanReceipt():
			return Line{}, "", nil, apperr.Conflict("only a paid session without a receipt can get one")
		}
		return SessionLine(s, cfg, h.Location), s.ClientID, s.Payment, nil
	case SourcePackage:
		p, found, err := h.Packages.Get(ctx, src.ID)
		if err != nil {
			return Line{}, "", nil, err
		}
		if !found {
			return Line{}, "", nil, apperr.NotFound("package not found")
		}
		if !p.Billable(spec.Slot) {
			return Line{}, "", nil, apperr.Conflict("this package already has a %s", strings.ToLower(spec.Title))
		}
		var payment *sessions.Payment
		if p.Source == packages.SourceCalendar {
			// Bought in a session (same ID), and paid with it.
			s, found, err := h.Sessions.Get(ctx, p.ID)
			if err != nil {
				return Line{}, "", nil, err
			}
			if found {
				payment = s.Payment
			}
		}
		return PackageLine(p, cfg, h.Location), p.ClientID, payment, nil
	default:
		return Line{}, "", nil, apperr.Invalid("unknown source kind %q", src.Kind)
	}
}

func uniqueSources(sources []Source) []Source {
	seen := map[Source]bool{}
	var out []Source
	for _, src := range sources {
		if !seen[src] {
			seen[src] = true
			out = append(out, src)
		}
	}
	return out
}

func (h handler) client(ctx context.Context, id string) (clients.Client, error) {
	c, found, err := h.Clients.Get(ctx, id)
	if err != nil {
		return c, err
	}
	if !found {
		return c, apperr.NotFound("client not found")
	}
	return c, nil
}

func (h handler) commit(ctx context.Context, w Write) error {
	return conflictErr(h.Repo.Commit(ctx, w))
}

func (h handler) afterChange(ctx context.Context, before, after Document) error {
	if h.AfterChange == nil || after.ClientID == "" {
		return nil
	}
	ids := []string{after.ClientID}
	if before.ClientID != "" && before.ClientID != after.ClientID {
		ids = append(ids, before.ClientID)
	}
	return h.AfterChange(ctx, ids...)
}

func conflictErr(err error) error {
	if errors.Is(err, dynamo.ErrTransactionConflict) {
		return apperr.Conflict("something changed while saving; reload and try again")
	}
	return err
}

func sourceSet(sources []Source) map[Source]bool {
	set := make(map[Source]bool, len(sources))
	for _, s := range sources {
		set[s] = true
	}
	return set
}

func lineDate(c Content, src Source) string {
	for _, line := range c.Lines {
		if line.Source != nil && *line.Source == src && line.Date != "" {
			return line.Date
		}
	}
	return ""
}

func linkPatch(src Source, slot docref.Slot, ref docref.Ref) (dynamo.Patch, error) {
	if src.Kind == SourcePackage {
		return packages.LinkPatch(src.ID, slot, ref)
	}
	return sessions.LinkPatch(src.ID, slot, ref)
}

func unlinkPatch(src Source, slot docref.Slot, documentID string) dynamo.Patch {
	if src.Kind == SourcePackage {
		return packages.UnlinkPatch(src.ID, slot, documentID)
	}
	return sessions.UnlinkPatch(src.ID, slot, documentID)
}
