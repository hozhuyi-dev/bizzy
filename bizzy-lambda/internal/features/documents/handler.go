package documents

import (
	"context"
	"errors"
	"slices"
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
	ListByType(ctx context.Context, docType Type) ([]Document, error)
	Revisions(ctx context.Context, id string) ([]Revision, error)
	Counter(ctx context.Context, key string) (int64, error)
	SetCounter(ctx context.Context, key string, last int64) (bool, error)
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
	r.Register("documents.get", router.Typed(h.get))
	r.Register("documents.createDraft", router.Typed(h.createDraft))
	r.Register("documents.saveDraft", router.Typed(h.saveDraft))
	r.Register("documents.issue", router.Typed(h.issue))
	r.Register("documents.revise", router.Typed(h.revise))
	r.Register("documents.discardDraft", router.Typed(h.discardDraft))
	r.Register("documents.cancel", router.Typed(h.cancel))
	r.Register("documents.numbering", router.Typed(h.numbering))
	r.Register("documents.setNextNumber", router.Typed(h.setNextNumber))
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

func (h handler) list(ctx context.Context, in typeInput) (any, error) {
	if _, err := in.spec(); err != nil {
		return nil, err
	}
	return h.Repo.ListByType(ctx, in.Type)
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

// createDraft starts a document from sessions and packages and reserves
// them, so none can end up on two documents.
func (h handler) createDraft(ctx context.Context, in createDraftInput) (any, error) {
	if _, err := (typeInput{Type: in.Type}).spec(); err != nil {
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
	clientID := ""

	for _, src := range sources {
		line, owner, err := h.sourceLine(ctx, src, cfg)
		if err != nil {
			return nil, err
		}
		if clientID != "" && owner != clientID {
			return nil, apperr.Invalid("one document covers one client")
		}
		clientID = owner

		link, err := linkPatch(src, ref)
		if err != nil {
			return nil, err
		}
		lines, links = append(lines, line), append(links, link)
	}

	client, err := h.client(ctx, clientID)
	if err != nil {
		return nil, err
	}
	content, err := Normalize(NewContent(cfg, client, today, lines), sourceSet(sources))
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
	cfg, err := h.Settings.Get(ctx)
	if err != nil {
		return nil, err
	}

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

		updated, w, err := h.prepareIssue(ctx, doc, cfg)
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

func (h handler) prepareIssue(ctx context.Context, doc Document, cfg settings.Settings) (Document, Write, error) {
	now := h.Now().UTC()
	content := *doc.Draft
	date, _ := time.Parse(time.DateOnly, content.Date)

	updated := doc
	w := Write{PreviousVersion: doc.Version}

	if doc.Number == "" {
		numbering := h.numberingFor(doc.Type, cfg)
		key := numbering.CounterKey(doc.Type, date)
		last, err := h.Repo.Counter(ctx, key)
		if err != nil {
			return doc, w, err
		}
		updated.Number = numbering.Format(last+1, date)
		updated.Revision = new(int)
		updated.IssuedAt = &now
		w.Counter = &CounterBump{Key: key, Prev: last, Next: last + 1}
	} else {
		next := *doc.Revision + 1
		updated.Revision = &next
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
			w.Links = append(w.Links, unlinkPatch(src, doc.ID))
			continue
		}
		kept = append(kept, src)
		ref := docref.Ref{
			DocumentID:  doc.ID,
			Number:      updated.Number,
			AmountCents: &amount,
			Date:        lineDate(content, src),
			ClientID:    doc.ClientID,
		}
		link, err := linkPatch(src, ref)
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
			w.Links = append(w.Links, unlinkPatch(src, doc.ID))
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
		w.Links = append(w.Links, unlinkPatch(src, doc.ID))
	}
	if err := h.commit(ctx, w); err != nil {
		return nil, err
	}
	if err := h.afterChange(ctx, doc, updated); err != nil {
		return nil, err
	}
	return updated, nil
}

type numberingOutput struct {
	Template string `json:"template"`
	// Next is the number the next document of this type will get.
	Next string `json:"next"`
	Seq  int64  `json:"seq"`
}

// numbering previews the next number, for Settings.
func (h handler) numbering(ctx context.Context, in typeInput) (any, error) {
	if _, err := in.spec(); err != nil {
		return nil, err
	}
	cfg, err := h.Settings.Get(ctx)
	if err != nil {
		return nil, err
	}
	n := h.numberingFor(in.Type, cfg)
	today := h.Now().In(h.Location)
	last, err := h.Repo.Counter(ctx, n.CounterKey(in.Type, today))
	if err != nil {
		return nil, err
	}
	return numberingOutput{Template: n.Template, Next: n.Format(last+1, today), Seq: last + 1}, nil
}

type setNextNumberInput struct {
	Type Type  `json:"type"`
	Next int64 `json:"next"`
}

// setNextNumber continues an existing sequence, e.g. from her old receipt
// book. It can only move forward.
func (h handler) setNextNumber(ctx context.Context, in setNextNumberInput) (any, error) {
	if _, err := (typeInput{Type: in.Type}).spec(); err != nil {
		return nil, err
	}
	if in.Next < 1 {
		return nil, apperr.Invalid("the next number must be at least 1")
	}
	cfg, err := h.Settings.Get(ctx)
	if err != nil {
		return nil, err
	}
	n := h.numberingFor(in.Type, cfg)
	ok, err := h.Repo.SetCounter(ctx, n.CounterKey(in.Type, h.Now().In(h.Location)), in.Next-1)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, apperr.Conflict("numbers can only move forward; that one may already be used")
	}
	return h.numbering(ctx, typeInput{Type: in.Type})
}

func (h handler) numberingFor(docType Type, cfg settings.Settings) Numbering {
	if template := cfg.Numbering[string(docType)]; template != "" {
		return Numbering{Template: template}
	}
	return Numbering{Template: Types[docType].DefaultNumbering}
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

// sourceLine checks a source can go on a document and prefills its line. It
// returns the client the source belongs to.
func (h handler) sourceLine(ctx context.Context, src Source, cfg settings.Settings) (Line, string, error) {
	switch src.Kind {
	case SourceSession:
		s, found, err := h.Sessions.Get(ctx, src.ID)
		if err != nil {
			return Line{}, "", err
		}
		if !found {
			return Line{}, "", apperr.NotFound("session not found")
		}
		if !s.Billable() {
			return Line{}, "", apperr.Conflict("only a paid session without a receipt can get one")
		}
		return SessionLine(s, cfg, h.Location), s.ClientID, nil
	case SourcePackage:
		p, found, err := h.Packages.Get(ctx, src.ID)
		if err != nil {
			return Line{}, "", err
		}
		if !found {
			return Line{}, "", apperr.NotFound("package not found")
		}
		if !p.Billable() {
			return Line{}, "", apperr.Conflict("this package already has a receipt")
		}
		return PackageLine(p, cfg, h.Location), p.ClientID, nil
	default:
		return Line{}, "", apperr.Invalid("unknown source kind %q", src.Kind)
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

func linkPatch(src Source, ref docref.Ref) (dynamo.Patch, error) {
	if src.Kind == SourcePackage {
		return packages.LinkPatch(src.ID, ref)
	}
	return sessions.LinkPatch(src.ID, ref)
}

func unlinkPatch(src Source, documentID string) dynamo.Patch {
	if src.Kind == SourcePackage {
		return packages.UnlinkPatch(src.ID, documentID)
	}
	return sessions.UnlinkPatch(src.ID, documentID)
}
