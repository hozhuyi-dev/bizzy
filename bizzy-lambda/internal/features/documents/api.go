package documents

import (
	"context"
	"slices"
	"time"

	"bizzy-lambda/internal/features/clients"
	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/platform/blobstore"
	"bizzy-lambda/internal/platform/listing"
	"bizzy-lambda/internal/platform/router"
	"bizzy-lambda/internal/platform/txn"
)

// Summary is a document as a list shows it, without what it prints.
type Summary struct {
	ID       string `json:"id"`
	Type     Type   `json:"type"`
	Status   Status `json:"status"`
	Number   string `json:"number,omitempty"`
	Revision *int   `json:"revision,omitempty"`
	ClientID string `json:"clientId"`
	Date     string `json:"date,omitempty"`
	// FiledAt is where it is in its lists (see filedAt).
	FiledAt    time.Time `json:"filedAt"`
	TotalCents int64     `json:"totalCents"`
	// RecipientName is who the current content is for.
	RecipientName string `json:"recipientName"`
	// Revising says an issued document has its next revision drafted.
	Revising   bool   `json:"revising,omitempty"`
	ShareToken string `json:"shareToken,omitempty"`
	// Covers is what its lines are for, so a list tells documents apart.
	Covers Covers `json:"covers"`
	// For are the clients its lines are for other than who pays, each
	// once, in line order: Mum's invoice for Adam's sessions.
	For []string `json:"for"`
	// CombineKey is the same for documents whose drafts can be put on one
	// (see Combine), each as its Can.MoveLines says.
	CombineKey string `json:"combineKey"`
	// Can is what a list offers to do with it.
	Can SummaryCan `json:"can"`
}

// combineKey is what documents share when their lines can move between
// their drafts: their type and client.
func combineKey(d *Document) string { return string(d.Type) + ":" + d.ClientID }

// Covers is what a document's lines are for: how many sessions, packages
// and other lines, and the span of their service dates (empty when none
// has one). Worked out from the item a list reads already.
type Covers struct {
	Sessions int    `json:"sessions"`
	Packages int    `json:"packages"`
	Other    int    `json:"other"`
	From     string `json:"from,omitempty"`
	To       string `json:"to,omitempty"`
}

// coversOf counts lines by what they cover and spans their dates.
func coversOf(lines []Line) Covers {
	var c Covers
	for _, l := range lines {
		switch {
		case l.Source != nil && l.Source.Kind == SourceSession:
			c.Sessions++
		case l.Source != nil && l.Source.Kind == SourcePackage:
			c.Packages++
		default:
			c.Other++
		}
		if l.Date == "" {
			continue
		}
		if c.From == "" || l.Date < c.From {
			c.From = l.Date
		}
		if l.Date > c.To {
			c.To = l.Date
		}
	}
	return c
}

// SummaryCan is what a list's actions on a document would say now:
// sending it for the client's records, asking to pay for it, and putting
// it together with other drafts.
type SummaryCan struct {
	Send      apperr.Verdict `json:"send"`
	AskToPay  apperr.Verdict `json:"askToPay"`
	MoveLines apperr.Verdict `json:"moveLines"`
}

// Can is what each action on a document would say now, for its page.
type Can struct {
	SummaryCan
	Issue        apperr.Verdict `json:"issue"`
	SetPayer     apperr.Verdict `json:"setPayer"`
	Revise       apperr.Verdict `json:"revise"`
	Cancel       apperr.Verdict `json:"cancel"`
	DiscardDraft apperr.Verdict `json:"discardDraft"`
}

// SummaryOf is a document as lists show it, with what is owed now (read
// once for the list).
func SummaryOf(d *Document, owing Owing) Summary {
	s := Summary{
		ID: d.ID, Type: d.Type, Status: d.Status, Number: d.Number, Revision: d.Revision, ClientID: d.ClientID,
		FiledAt: d.filedAt(), Revising: d.Status == StatusIssued && d.Draft != nil, ShareToken: d.ShareToken,
		CombineKey: combineKey(d),
	}
	// The document's own steps, which never fail to say.
	s.Can.Send, _ = apperr.VerdictOf(CanSend(d))
	s.Can.AskToPay, _ = apperr.VerdictOf(owing.canAskOn(d))
	s.Can.MoveLines, _ = apperr.VerdictOf(CanMoveLines(d))
	c := d.Content
	if c == nil {
		c = d.Draft
	}
	s.For = []string{}
	if c != nil {
		s.Date, s.TotalCents, s.RecipientName = c.Date, c.TotalCents, c.Recipient.Name
		s.Covers = coversOf(c.Lines)
		for _, l := range c.Lines {
			if l.For != nil && !slices.Contains(s.For, l.For.ClientID) {
				s.For = append(s.For, l.For.ClientID)
			}
		}
	}
	return s
}

// View is a document as its page shows it: what it prints, the draft as
// it would be issued now (see Fill), and every revision issued.
type View struct {
	Summary
	Content      *Content   `json:"content,omitempty"`
	Draft        *Content   `json:"draft,omitempty"`
	CreatedAt    time.Time  `json:"createdAt"`
	IssuedAt     *time.Time `json:"issuedAt,omitempty"`
	CancelledAt  *time.Time `json:"cancelledAt,omitempty"`
	CancelReason string     `json:"cancelReason,omitempty"`
	Revisions    []Revision `json:"revisions"`
	// Can is what each action on it would say now; Locked what its draft
	// can't change (see Locks).
	Can    Can          `json:"can"`
	Locked apperr.Locks `json:"locked"`
}

// Locks are what a revision of an issued document can't change: what has
// legal weight (see Legal). Its total follows its amounts.
func Locks(d *Document) (apperr.Locks, error) {
	if d.Draft == nil || !d.Issued() {
		return apperr.Locks{}, nil
	}
	return apperr.LocksOf(map[string]error{
		"date":                  stayIssued(d, "its date"),
		"issuer.name":           stayIssued(d, "the business that issued it"),
		"issuer.registrationNo": stayIssued(d, "the business that issued it"),
		"lines":                 stayIssued(d, "its lines and their amounts"),
		"lines.amountCents":     stayIssued(d, "its lines and their amounts"),
	})
}

func viewOf(tx *txn.Tx, d *Document, checks []Check) (*View, error) {
	if d == nil {
		return nil, nil
	}
	owing, err := OwingOf(tx)
	if err != nil {
		return nil, err
	}
	v := &View{
		Summary: SummaryOf(d, owing), Content: d.Content, Draft: d.Draft, CreatedAt: d.CreatedAt,
		IssuedAt: d.IssuedAt, CancelledAt: d.CancelledAt, CancelReason: d.CancelReason, Revisions: []Revision{},
	}
	v.Can.SummaryCan = v.Summary.Can
	for _, c := range []struct {
		verdict *apperr.Verdict
		check   error
	}{
		{&v.Can.Issue, CanIssue(tx, d, checks...)},
		{&v.Can.SetPayer, CanSetPayer(tx, d)},
		{&v.Can.Revise, CanRevise(d)},
		{&v.Can.Cancel, CanCancel(d)},
		{&v.Can.DiscardDraft, CanDiscardDraft(d)},
	} {
		var err error
		if *c.verdict, err = apperr.VerdictOf(c.check); err != nil {
			return nil, err
		}
	}
	if d.Draft != nil && !d.Issued() {
		content, err := filled(tx, d)
		if err != nil {
			return nil, err
		}
		v.Draft = &content
	}
	locked, err := Locks(d)
	if err != nil {
		return nil, err
	}
	v.Locked = locked
	revs, err := Revisions.WithRef(tx, d.ID)
	for _, r := range revs {
		v.Revisions = append(v.Revisions, *r)
	}
	return v, err
}

// SharedView is what a share link shows: the issued content and its PDF,
// never a draft or a revision in progress (see cmd/public).
type SharedView struct {
	Type        Type       `json:"type"`
	Status      Status     `json:"status"`
	Number      string     `json:"number"`
	Revision    *int       `json:"revision,omitempty"`
	Content     Content    `json:"content"`
	CancelledAt *time.Time `json:"cancelledAt,omitempty"`
	PDF         File       `json:"pdf"`
}

// SharedViewOf is an opened document as its link shows it (see Open), with
// its PDF.
func SharedViewOf(d *Document, pdf File) SharedView {
	return SharedView{Type: d.Type, Status: d.Status, Number: d.Number, Revision: d.Revision, Content: *d.Content, CancelledAt: d.CancelledAt, PDF: pdf}
}

// searchRequest finds documents by words in their number, who they are
// for or the client's name, and by days (where it is filed: a draft
// without a date by its latest service date), types, clients and status,
// and invoices with something still owed on them (Unpaid); an empty filter
// takes every value.
type searchRequest struct {
	listing.Request
	Types     []Type   `json:"types"`
	ClientIDs []string `json:"clientIds"`
	Statuses  []Status `json:"statuses"`
	Unpaid    bool     `json:"unpaid"`
}

// list is where a search reads, latest first: a client's documents for
// one client, a type's for one type, else every one.
func (in searchRequest) list(from, to time.Time) txn.List {
	l := txn.List{From: from, To: to, Latest: true}
	switch {
	case len(in.ClientIDs) == 1:
		l.Client = in.ClientIDs[0]
	case len(in.Types) == 1:
		l.Tag = string(in.Types[0])
	}
	return l
}

// takes says whether a document is one the search is for, its words aside.
func (in searchRequest) takes(d *Document, owing Owing) bool {
	if !listing.OneOf(in.Types, d.Type) || !listing.OneOf(in.ClientIDs, d.ClientID) || !listing.OneOf(in.Statuses, d.Status) {
		return false
	}
	return !in.Unpaid || d.Status != StatusCancelled && len(owing.owedOn(d)) > 0
}

type clientRequest struct {
	ClientID string `json:"clientId"`
}

type idRequest struct {
	ID string `json:"id"`
}

type pdfRequest struct {
	ID string `json:"id"`
	// Revision is an issued revision; nil for the latest.
	Revision *int `json:"revision"`
}

type saveDraftRequest struct {
	ID      string  `json:"id"`
	Content Content `json:"content"`
}

type cancelRequest struct {
	ID     string `json:"id"`
	Reason string `json:"reason"`
}

type moveLinesRequest struct {
	From string `json:"from"`
	// To is "" for a new draft.
	To      string   `json:"to"`
	LineIDs []string `json:"lineIds"`
}

type combineRequest struct {
	// IDs are the drafts to put together; the first keeps them.
	IDs []string `json:"ids"`
}

type placeRequest struct {
	Type Type `json:"type"`
	// Into is the draft to put them on; "" for a new one.
	Into  string   `json:"into"`
	Items []Source `json:"items"`
}

// askRequest is what to ask to pay for: items (a session and the package
// bought in it, a package) and invoices.
type askRequest struct {
	Items []Source `json:"items"`
	IDs   []string `json:"ids"`
}

type recordsRequest struct {
	Items []Source `json:"items"`
}

type setPayerRequest struct {
	ID       string `json:"id"`
	ClientID string `json:"clientId"`
}

type shareRequest struct {
	IDs []string `json:"ids"`
}

// Routes registers the documents' actions. Issued PDFs are kept in blobs
// (see pdf.go); checks are what other features hold a document to before
// it is issued (see Check).
func Routes(r *router.Router, run *txn.Runner, blobs blobstore.Store, checks ...Check) {
	// step runs a step of a document's lifecycle and returns it; null when
	// the step deleted it.
	step := func(ctx context.Context, do func(tx *txn.Tx) (*Document, error)) (any, error) {
		return txn.Run(ctx, run, func(tx *txn.Tx) (*View, error) {
			d, err := do(tx)
			if err != nil {
				return nil, err
			}
			if d != nil {
				if _, kept, err := Documents.Find(tx, d.ID); err != nil || !kept {
					return nil, err
				}
			}
			return viewOf(tx, d, checks)
		})
	}

	// documents.search finds invoices and receipts, latest first, a page
	// at a time.
	r.Query("documents.search", router.Typed(func(ctx context.Context, in searchRequest) (any, error) {
		for _, t := range in.Types {
			if _, ok := Types[t]; !ok {
				return nil, apperr.Invalid("Unknown document type %q.", t)
			}
		}
		return txn.Read(ctx, run, func(tx *txn.Tx) (listing.Page[Summary], error) {
			// Document dates are days, filed as UTC.
			from, to, err := in.Span(time.UTC)
			if err != nil {
				return listing.Page[Summary]{}, err
			}
			words := in.Words()
			owing, err := OwingOf(tx)
			if err != nil {
				return listing.Page[Summary]{}, err
			}
			return listing.Read(tx, Documents, in.list(from, to), in.Request, func(d *Document) (Summary, bool, error) {
				if !in.takes(d, owing) {
					return Summary{}, false, nil
				}
				s := SummaryOf(d, owing)
				client, err := clients.Clients.Get(tx, d.ClientID)
				if err != nil {
					return Summary{}, false, err
				}
				return s, words.In(s.Number, s.RecipientName, client.Name), nil
			})
		})
	}))
	// documents.listByClient lists a client's documents of every type,
	// latest first, as documents.search does (see filedAt): those they
	// pay, and those someone else pays for what is theirs.
	r.Query("documents.listByClient", router.Typed(func(ctx context.Context, in clientRequest) (any, error) {
		return txn.Read(ctx, run, func(tx *txn.Tx) ([]Summary, error) {
			all, err := OfClient(tx, in.ClientID)
			if err != nil {
				return nil, err
			}
			return summaries(tx, all)
		})
	}))
	r.Query("documents.get", router.Typed(func(ctx context.Context, in idRequest) (any, error) {
		return txn.Read(ctx, run, func(tx *txn.Tx) (*View, error) {
			d, err := Documents.Get(tx, in.ID)
			if err != nil {
				return nil, err
			}
			return viewOf(tx, d, checks)
		})
	}))
	r.Mutation("documents.saveDraft", router.Typed(func(ctx context.Context, in saveDraftRequest) (any, error) {
		return step(ctx, func(tx *txn.Tx) (*Document, error) { return SaveDraft(tx, in.ID, in.Content) })
	}))
	r.Mutation("documents.issue", router.Typed(func(ctx context.Context, in idRequest) (any, error) {
		out, err := step(ctx, func(tx *txn.Tx) (*Document, error) { return Issue(tx, in.ID, checks...) })
		if v, ok := out.(*View); ok && v != nil {
			keepIssued(ctx, blobs, v)
		}
		return out, err
	}))
	// documents.pdf is an issued revision's PDF, as issued (see pdf.go).
	// It stores one the issue didn't manage to.
	r.Query("documents.pdf", router.Typed(func(ctx context.Context, in pdfRequest) (any, error) {
		type revisionOf struct {
			doc *Document
			rev *Revision
		}
		found, err := txn.Read(ctx, run, func(tx *txn.Tx) (revisionOf, error) {
			d, err := Documents.Get(tx, in.ID)
			if err != nil {
				return revisionOf{}, err
			}
			if in.Revision == nil {
				r, err := IssuedRevision(tx, d)
				return revisionOf{d, r}, err
			}
			r, err := Revisions.Get(tx, revisionID(d.ID, *in.Revision))
			return revisionOf{d, r}, err
		})
		if err != nil {
			return nil, err
		}
		return ServedPDF(ctx, blobs, found.doc, found.rev, true)
	}))
	// documents.preview is a draft's PDF as it would be issued now, from
	// the content the editor has, saved or not.
	r.Query("documents.preview", router.Typed(func(ctx context.Context, in saveDraftRequest) (any, error) {
		return txn.Read(ctx, run, func(tx *txn.Tx) (File, error) {
			d, err := Documents.Get(tx, in.ID)
			if err != nil {
				return File{}, err
			}
			if d.Draft == nil {
				return File{}, notAtStep("This document is not being edited.")
			}
			return preview(tx, d, in.Content)
		})
	}))
	r.Mutation("documents.revise", router.Typed(func(ctx context.Context, in idRequest) (any, error) {
		return step(ctx, func(tx *txn.Tx) (*Document, error) { return Revise(tx, in.ID) })
	}))
	r.Mutation("documents.discardDraft", router.Typed(func(ctx context.Context, in idRequest) (any, error) {
		return step(ctx, func(tx *txn.Tx) (*Document, error) { return DiscardDraft(tx, in.ID) })
	}))
	r.Mutation("documents.cancel", router.Typed(func(ctx context.Context, in cancelRequest) (any, error) {
		return step(ctx, func(tx *txn.Tx) (*Document, error) { return Cancel(tx, in.ID, in.Reason) })
	}))
	r.Mutation("documents.moveLines", router.Typed(func(ctx context.Context, in moveLinesRequest) (any, error) {
		return txn.Run(ctx, run, func(tx *txn.Tx) (any, error) { return nil, MoveLines(tx, in.From, in.To, in.LineIDs) })
	}))
	r.Mutation("documents.setPayer", router.Typed(func(ctx context.Context, in setPayerRequest) (any, error) {
		return step(ctx, func(tx *txn.Tx) (*Document, error) { return SetPayer(tx, in.ID, in.ClientID) })
	}))
	r.Mutation("documents.combine", router.Typed(func(ctx context.Context, in combineRequest) (any, error) {
		return step(ctx, func(tx *txn.Tx) (*Document, error) { return Combine(tx, in.IDs) })
	}))
	r.Mutation("documents.place", router.Typed(func(ctx context.Context, in placeRequest) (any, error) {
		if _, ok := Types[in.Type]; !ok {
			return nil, apperr.Invalid("Unknown document type %q.", in.Type)
		}
		if len(in.Items) == 0 {
			return nil, apperr.Invalid("Choose what to put on it.")
		}
		return step(ctx, func(tx *txn.Tx) (d *Document, err error) {
			into := in.Into
			for _, src := range in.Items {
				if d, err = Place(tx, src, in.Type, into); err != nil {
					return nil, err
				}
				into = d.ID
			}
			return d, nil
		})
	}))
	// documents.ask is what a message asking to pay says (see AskFor).
	r.Query("documents.ask", router.Typed(func(ctx context.Context, in askRequest) (any, error) {
		return txn.Read(ctx, run, func(tx *txn.Tx) (Ask, error) {
			a, err := AskFor(tx, in.Items, in.IDs)
			if err != nil {
				return Ask{}, err
			}
			return a, askable(a)
		})
	}))
	// documents.records is the issued documents covering items, to send
	// for the client's records (see Records).
	r.Query("documents.records", router.Typed(func(ctx context.Context, in recordsRequest) (any, error) {
		return txn.Read(ctx, run, func(tx *txn.Tx) ([]Summary, error) {
			docs, err := Records(tx, in.Items)
			if err == nil {
				err = sendable(docs)
			}
			if err != nil {
				return nil, err
			}
			return summaries(tx, docs)
		})
	}))
	r.Mutation("documents.share", router.Typed(func(ctx context.Context, in shareRequest) (any, error) {
		if len(in.IDs) == 0 {
			return nil, apperr.Invalid("Choose what to share.")
		}
		return txn.Read(ctx, run, func(tx *txn.Tx) (map[string]string, error) { return ShareAll(tx, in.IDs) })
	}))
	r.Mutation("documents.resetShare", router.Typed(func(ctx context.Context, in idRequest) (any, error) {
		return step(ctx, func(tx *txn.Tx) (*Document, error) { return ResetShare(tx, in.ID) })
	}))
}

func summaries(tx *txn.Tx, all []*Document) ([]Summary, error) {
	owing, err := OwingOf(tx)
	out := []Summary{}
	for _, d := range all {
		out = append(out, SummaryOf(d, owing))
	}
	return out, err
}
