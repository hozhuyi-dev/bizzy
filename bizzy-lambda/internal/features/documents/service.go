package documents

import (
	"context"
	"errors"
	"slices"
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

// Store is the documents repository.
type Store interface {
	Get(ctx context.Context, id string) (Document, bool, error)
	ListByMonth(ctx context.Context, docType Type, month string) ([]Document, error)
	ListByClient(ctx context.Context, clientID string) ([]Document, error)
	SharedID(ctx context.Context, token string) (string, bool, error)
	Revisions(ctx context.Context, id string) ([]Revision, error)
	Counter(ctx context.Context, key string) (int64, error)
	Commit(ctx context.Context, w Write) error
}

type Deps struct {
	Repo     Store
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
	// Refresh applies what the calendar changed since the last sync on
	// these events (sessions, and the packages their titles buy), so a
	// document is issued from what the calendar says now. Nil skips it.
	Refresh  func(ctx context.Context, eventIDs ...string) error
	Location *time.Location
	Now      func() time.Time
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

// Get returns a document and its issued revisions. A draft shows its lines
// as they follow what they cover now (see follow); saving or issuing it
// writes them.
func (svc Service) Get(ctx context.Context, id string) (Document, []Revision, error) {
	doc, err := svc.load(ctx, id, 0)
	if err != nil {
		return doc, nil, err
	}
	if doc.Draft != nil {
		// A receipt whose payment no longer settles it shows as it was:
		// issuing it says why it can't be.
		if followed, err := svc.follow(ctx, doc.Type, *doc.Draft); err == nil {
			doc.Draft = &followed
		}
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
	var links []Link
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

		lines, links, payments = append(lines, line), append(links, Hold(src, spec.Slot, ref)), append(payments, payment)
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
	// A draft already holds what it covers: a session mirrors that the
	// package it bought is now held (it locks the booking).
	if err := svc.afterChange(ctx, Document{}, doc); err != nil {
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
	if content, err = svc.follow(ctx, doc.Type, content); err != nil {
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
	if svc.Refresh != nil {
		doc, err := svc.load(ctx, id, version)
		if err != nil {
			return Document{}, err
		}
		var events []string
		for _, src := range doc.Sources {
			events = append(events, src.ID)
		}
		if err := svc.Refresh(ctx, events...); err != nil {
			return Document{}, err
		}
	}
	// A conflict on the counter means another document took the number
	// first; read it again and retry.
	for attempt := 0; ; attempt++ {
		doc, err := svc.load(ctx, id, version)
		if err != nil {
			return Document{}, err
		}
		if doc.Draft != nil {
			// What it says follows the calendar and the payments up to the
			// moment it is issued.
			followed, err := svc.follow(ctx, doc.Type, *doc.Draft)
			if err != nil {
				return Document{}, err
			}
			doc.Draft = &followed
		}
		now, err := svc.sourcesNow(ctx, doc)
		if err != nil {
			return Document{}, err
		}
		owners := map[Source]string{}
		for src, it := range now {
			owners[src] = it.clientID
		}
		if err := doc.CanIssue(owners); err != nil {
			return Document{}, err
		}

		updated, w, err := svc.prepareIssue(ctx, doc, now)
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

func (svc Service) prepareIssue(ctx context.Context, doc Document, sources map[Source]sourceNow) (Document, Write, error) {
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
			w.Links = append(w.Links, Release(src, spec.Slot, doc.ID))
			continue
		}
		kept = append(kept, src)
		ref := docref.Ref{
			DocumentID:  doc.ID,
			Number:      updated.Number,
			Revision:    *updated.Revision,
			AmountCents: &amount,
			FeeCents:    sources[src].feeCents,
			Date:        lineDate(content, src),
			ClientID:    doc.ClientID,
		}
		w.Links = append(w.Links, Hold(src, spec.Slot, ref))
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
	if err := doc.CanRevise(); err != nil {
		return Document{}, err
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
	if err := doc.CanDiscardDraft(); err != nil {
		return nil, err
	}

	if doc.Number == "" {
		w := Write{Doc: doc, PreviousVersion: doc.Version, Delete: true}
		for _, src := range doc.Sources {
			w.Links = append(w.Links, Release(src, Types[doc.Type].Slot, doc.ID))
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
	if err := doc.CanCancel(); err != nil {
		return Document{}, err
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
		w.Links = append(w.Links, Release(src, Types[doc.Type].Slot, doc.ID))
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
		guard := s.CanInvoice
		if spec.Slot == docref.SlotReceipt {
			guard = s.CanReceipt
		}
		if err := guard(); err != nil {
			return Line{}, "", nil, err
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
		if err := p.CanBill(spec.Slot); err != nil {
			return Line{}, "", nil, err
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

// afterChange reconciles the clients whose items the document now covers
// differently: the document's, and whoever its sources belong to now (the
// calendar may have moved a session to another client since, which is
// what drift reports).
func (svc Service) afterChange(ctx context.Context, before, after Document) error {
	if svc.AfterChange == nil {
		return nil
	}
	var ids []string
	add := func(id string) {
		if id != "" && !slices.Contains(ids, id) {
			ids = append(ids, id)
		}
	}
	add(after.ClientID)
	add(before.ClientID)
	for _, src := range slices.Concat(before.Sources, after.Sources) {
		it, err := svc.sourceNow(ctx, src)
		if err != nil {
			return err
		}
		add(it.clientID)
	}
	if len(ids) == 0 {
		return nil
	}
	return svc.AfterChange(ctx, ids...)
}

// sourceNow is what a document checks of an item it covers as it issues.
type sourceNow struct {
	clientID string
	// feeCents is what the item itself costs now: the session's fee, the
	// package's price.
	feeCents *int64
}

// sourcesNow reads each source the draft still has a line for.
func (svc Service) sourcesNow(ctx context.Context, doc Document) (map[Source]sourceNow, error) {
	out := map[Source]sourceNow{}
	if doc.Draft == nil {
		return out, nil
	}
	for src := range sourceAmounts(*doc.Draft) {
		it, err := svc.sourceNow(ctx, src)
		if err != nil {
			return nil, err
		}
		out[src] = it
	}
	return out, nil
}

// sourceNow reads one item a document covers; zero when it is gone.
func (svc Service) sourceNow(ctx context.Context, src Source) (sourceNow, error) {
	if src.Kind == SourcePackage {
		p, found, err := svc.Packages.Get(ctx, src.ID)
		if !found || err != nil {
			return sourceNow{}, err
		}
		price := p.PriceCents
		return sourceNow{clientID: p.ClientID, feeCents: &price}, nil
	}
	s, found, err := svc.Sessions.Get(ctx, src.ID)
	if !found || err != nil {
		return sourceNow{}, err
	}
	fee := s.DueCents()
	return sourceNow{clientID: s.ClientID, feeCents: &fee}, nil
}

// follow sets each line a session or package has to what it says now: the
// date it happened or was bought, and the amount, its fee or price on an
// invoice and what was received for it on a receipt. A draft can't then be
// issued saying something the calendar or the payments no longer do, which
// drift would flag at once. Lines of her own, the descriptions and how it
// was paid stay as she wrote them, and a receipt waits for a payment that
// settles the amount due.
func (svc Service) follow(ctx context.Context, docType Type, c Content) (Content, error) {
	out := c
	out.Lines = slices.Clone(c.Lines)
	out.TotalCents = 0
	for i, line := range out.Lines {
		if line.Source != nil {
			date, amount, err := svc.says(ctx, docType, *line.Source)
			if err != nil {
				return c, err
			}
			if date != "" {
				out.Lines[i].Date, out.Lines[i].AmountCents = date, amount
			}
		}
		out.TotalCents += out.Lines[i].AmountCents
	}
	return out, nil
}

// says is what a source's line says now on a document of the type: its
// date, and its amount (on a receipt, what the payment received). The
// date is "" when the source is gone.
func (svc Service) says(ctx context.Context, docType Type, src Source) (date string, amount int64, err error) {
	var due int64
	var at time.Time
	var payment *money.Payment
	if src.Kind == SourcePackage {
		p, found, err := svc.Packages.Get(ctx, src.ID)
		if !found || err != nil {
			return "", 0, err
		}
		at, due, payment = p.PurchasedAt, p.PriceCents, p.Payment
	} else {
		s, found, err := svc.Sessions.Get(ctx, src.ID)
		if !found || err != nil {
			return "", 0, err
		}
		if s.RemovedAt == nil && s.Status != sessions.StatusPriced {
			return "", 0, apperr.Conflict("The calendar changed the session on %s: it has no fee of its own now. Fix it, or take its line off, first.", s.Start.In(svc.Location).Format("2 Jan"))
		}
		at, due, payment = s.Start, s.DueCents(), s.Payment
		if s.FeeCents != nil && s.Status != sessions.StatusPriced {
			due = *s.FeeCents
		}
	}
	date = at.In(svc.Location).Format(time.DateOnly)
	if docType != TypeReceipt {
		return date, due, nil
	}
	switch {
	case !payment.IsPaid():
		return "", 0, apperr.Conflict("A receipt confirms money received: record the payment first.")
	case payment.Outdated(due):
		return "", 0, apperr.Conflict("The amount due is now %s, but %s was paid: record the payment at the new amount first.", money.Format(due), money.Format(payment.AmountCents))
	}
	return date, payment.AmountCents, nil
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
