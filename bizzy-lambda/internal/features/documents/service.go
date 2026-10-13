package documents

import (
	"context"
	"errors"
	"slices"
	"strings"
	"time"

	"bizzy-lambda/internal/features/clients"
	"bizzy-lambda/internal/features/packages"
	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/features/settings"
	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/platform/dynamo"
	"bizzy-lambda/internal/shared/docref"
	"bizzy-lambda/internal/shared/money"
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

// Service is a document's lifecycle: draft, issue, revise, discard, cancel
// and share. Each step is one transaction over the document and the links
// on the sessions and packages it covers.
type Service struct{ Deps }

func specOf(docType Type) (TypeSpec, error) {
	spec, ok := Types[docType]
	if !ok {
		return spec, apperr.Invalid("unknown document type %q", docType)
	}
	return spec, nil
}

// List returns one month of one type of document, newest first, as
// summaries: a list needs no printed content, which is most of a document's
// size.
func (svc Service) List(ctx context.Context, docType Type, month string) ([]Summary, error) {
	if _, err := specOf(docType); err != nil {
		return nil, err
	}
	docs, err := svc.Repo.ListByMonth(ctx, docType, month)
	if err != nil {
		return nil, err
	}
	return summaries(docs), nil
}

// ListByClient returns a client's documents of every type, newest first.
func (svc Service) ListByClient(ctx context.Context, clientID string) ([]Summary, error) {
	docs, err := svc.Repo.ListByClient(ctx, clientID)
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

// Get returns a document and its issued revisions.
func (svc Service) Get(ctx context.Context, id string) (Document, []Revision, error) {
	doc, err := svc.load(ctx, id, 0)
	if err != nil {
		return doc, nil, err
	}
	revisions, err := svc.Repo.Revisions(ctx, id)
	return doc, revisions, err
}

// CreateDraft starts a document from sessions and packages and reserves
// them, so none can end up on two documents of the type. The sources are
// all for one client: usually one session, or a session and the package its
// title bought.
func (svc Service) CreateDraft(ctx context.Context, docType Type, sources []Source) (Document, error) {
	spec, err := specOf(docType)
	if err != nil {
		return Document{}, err
	}
	sources = uniqueSources(sources)
	if len(sources) == 0 {
		return Document{}, apperr.Invalid("choose what the document covers")
	}
	cfg, err := svc.Settings.Get(ctx)
	if err != nil {
		return Document{}, err
	}
	now := svc.Now().UTC()
	today := now.In(svc.Location).Format(time.DateOnly)
	ref := docref.Ref{DocumentID: dynamo.NewID()}

	var lines []Line
	var links []dynamo.Patch
	var payments []*money.Payment
	clientID := ""

	for _, src := range sources {
		line, owner, payment, err := svc.sourceLine(ctx, src, spec, cfg)
		if err != nil {
			return Document{}, err
		}
		if clientID != "" && owner != clientID {
			return Document{}, apperr.Invalid("one document covers one client")
		}
		clientID = owner

		link, err := linkPatch(src, spec.Slot, ref)
		if err != nil {
			return Document{}, err
		}
		lines, links, payments = append(lines, line), append(links, link), append(payments, payment)
	}

	client, err := svc.client(ctx, clientID)
	if err != nil {
		return Document{}, err
	}
	draft := NewContent(cfg, client, today, lines)
	if docType == TypeReceipt {
		draft.PaidBy = money.PaidBy(payments)
	}
	content, err := Normalize(draft, sourceSet(sources))
	if err != nil {
		return Document{}, err
	}

	doc := Document{
		ID:         ref.DocumentID,
		Type:       docType,
		Status:     StatusDraft,
		ClientID:   clientID,
		Date:       content.Date,
		TotalCents: content.TotalCents,
		Sources:    sources,
		Draft:      &content,
		CreatedAt:  now,
		Version:    1,
	}
	if err := svc.commit(ctx, Write{Doc: doc, Links: links}); err != nil {
		return Document{}, err
	}
	return doc, nil
}

// SaveDraft replaces the content of the draft being edited.
func (svc Service) SaveDraft(ctx context.Context, id string, version int, content Content) (Document, error) {
	doc, err := svc.load(ctx, id, version)
	if err != nil {
		return Document{}, err
	}
	if doc.Draft == nil {
		return Document{}, apperr.Conflict("this document is not being edited")
	}

	content, err = Normalize(content, sourceSet(doc.Sources))
	if err != nil {
		return Document{}, err
	}

	updated := doc
	updated.Draft = &content
	if updated.Status == StatusDraft {
		updated.Date, updated.TotalCents = content.Date, content.TotalCents
	}
	updated.Version++

	if err := svc.commit(ctx, Write{Doc: updated, PreviousVersion: doc.Version}); err != nil {
		return Document{}, err
	}
	return updated, nil
}

// Issue makes the draft final: the first time it takes a number (rev 0),
// afterwards it becomes the next revision under the same number.
func (svc Service) Issue(ctx context.Context, id string, version int) (Document, error) {
	// A conflict on the counter means another document took the number
	// first; read it again and retry.
	for attempt := 0; ; attempt++ {
		doc, err := svc.load(ctx, id, version)
		if err != nil {
			return Document{}, err
		}
		if doc.Draft == nil {
			return Document{}, apperr.Conflict("there is nothing to issue")
		}

		updated, w, err := svc.prepareIssue(ctx, doc)
		if err != nil {
			return Document{}, err
		}
		err = svc.Repo.Commit(ctx, w)
		if errors.Is(err, dynamo.ErrTransactionConflict) && w.Counter != nil && attempt < 3 {
			continue
		}
		if err := conflictErr(err); err != nil {
			return Document{}, err
		}

		if err := svc.afterChange(ctx, doc, updated); err != nil {
			return Document{}, err
		}
		return updated, nil
	}
}

func (svc Service) prepareIssue(ctx context.Context, doc Document) (Document, Write, error) {
	now := svc.Now().UTC()
	content := *doc.Draft
	spec := Types[doc.Type]

	updated := doc
	w := Write{PreviousVersion: doc.Version}

	if doc.Number == "" {
		issued := now.In(svc.Location)
		key := counterKey(doc.Type, issued)
		last, err := svc.Repo.Counter(ctx, key)
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

// Revise opens an issued document for editing again. The issued revision
// stays the valid one until the new draft is issued.
func (svc Service) Revise(ctx context.Context, id string, version int) (Document, error) {
	doc, err := svc.load(ctx, id, version)
	if err != nil {
		return Document{}, err
	}
	if doc.Status != StatusIssued || doc.Draft != nil {
		return Document{}, apperr.Conflict("only an issued document can be revised")
	}

	updated := doc
	draft := *doc.Content
	draft.Lines = slices.Clone(doc.Content.Lines)
	updated.Draft = &draft
	updated.Version++

	if err := svc.commit(ctx, Write{Doc: updated, PreviousVersion: doc.Version}); err != nil {
		return Document{}, err
	}
	return updated, nil
}

// DiscardDraft throws a draft away: a never-issued document disappears (it
// had no number, and nil is returned) and releases what it covered; a
// revision in progress just goes back to the issued one.
func (svc Service) DiscardDraft(ctx context.Context, id string, version int) (*Document, error) {
	doc, err := svc.load(ctx, id, version)
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
		if err := svc.commit(ctx, w); err != nil {
			return nil, err
		}
		// A session kept only because the draft held it can now go.
		return nil, svc.afterChange(ctx, doc, doc)
	}

	updated := doc
	updated.Draft = nil
	updated.Version++
	if err := svc.commit(ctx, Write{Doc: updated, PreviousVersion: doc.Version}); err != nil {
		return nil, err
	}
	return &updated, nil
}

// Cancel voids an issued document. Its number stays used and its revisions
// are kept; what it covered is released.
func (svc Service) Cancel(ctx context.Context, id string, version int, reason string) (Document, error) {
	doc, err := svc.load(ctx, id, version)
	if err != nil {
		return Document{}, err
	}
	if doc.Status != StatusIssued {
		return Document{}, apperr.Conflict("only an issued document can be cancelled; discard a draft instead")
	}

	now := svc.Now().UTC()
	updated := doc
	updated.Status = StatusCancelled
	updated.Draft = nil
	updated.CancelledAt = &now
	updated.CancelReason = reason
	updated.Version++

	w := Write{Doc: updated, PreviousVersion: doc.Version}
	for _, src := range doc.Sources {
		w.Links = append(w.Links, unlinkPatch(src, Types[doc.Type].Slot, doc.ID))
	}
	if err := svc.commit(ctx, w); err != nil {
		return Document{}, err
	}
	if err := svc.afterChange(ctx, doc, updated); err != nil {
		return Document{}, err
	}
	return updated, nil
}

// load reads a document. A version other than 0 is the one she was looking
// at, so a stale tab can't overwrite.
func (svc Service) load(ctx context.Context, id string, version int) (Document, error) {
	doc, found, err := svc.Repo.Get(ctx, id)
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
// its line. It returns the client the source belongs to and what she
// recorded as paid for it.
func (svc Service) sourceLine(ctx context.Context, src Source, spec TypeSpec, cfg settings.Settings) (Line, string, *money.Payment, error) {
	switch src.Kind {
	case SourceSession:
		s, found, err := svc.Sessions.Get(ctx, src.ID)
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
		return SessionLine(s, cfg, svc.Location), s.ClientID, s.Payment, nil
	case SourcePackage:
		p, found, err := svc.Packages.Get(ctx, src.ID)
		if err != nil {
			return Line{}, "", nil, err
		}
		if !found {
			return Line{}, "", nil, apperr.NotFound("package not found")
		}
		switch {
		case p.Ref(spec.Slot) != nil:
			return Line{}, "", nil, apperr.Conflict("this package already has a %s", strings.ToLower(spec.Title))
		case !p.Billable(spec.Slot):
			return Line{}, "", nil, apperr.Conflict("only a paid package can get a receipt")
		}
		return PackageLine(p, cfg, svc.Location), p.ClientID, p.Payment, nil
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

func (svc Service) client(ctx context.Context, id string) (clients.Client, error) {
	c, found, err := svc.Clients.Get(ctx, id)
	if err != nil {
		return c, err
	}
	if !found {
		return c, apperr.NotFound("client not found")
	}
	return c, nil
}

func (svc Service) commit(ctx context.Context, w Write) error {
	return conflictErr(svc.Repo.Commit(ctx, w))
}

func (svc Service) afterChange(ctx context.Context, before, after Document) error {
	if svc.AfterChange == nil || after.ClientID == "" {
		return nil
	}
	ids := []string{after.ClientID}
	if before.ClientID != "" && before.ClientID != after.ClientID {
		ids = append(ids, before.ClientID)
	}
	return svc.AfterChange(ctx, ids...)
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
