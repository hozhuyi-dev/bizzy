package documents

import (
	"cmp"
	"context"
	"slices"
	"time"

	"bizzy-lambda/internal/features/clients"
	"bizzy-lambda/internal/features/settings"
	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/platform/listing"
	"bizzy-lambda/internal/platform/router"
	"bizzy-lambda/internal/platform/txn"
)

// Summary is a document as a list shows it, without what it prints.
type Summary struct {
	ID         string `json:"id"`
	Type       Type   `json:"type"`
	Status     Status `json:"status"`
	Number     string `json:"number,omitempty"`
	Revision   *int   `json:"revision,omitempty"`
	ClientID   string `json:"clientId"`
	Date       string `json:"date,omitempty"`
	TotalCents int64  `json:"totalCents"`
	// RecipientName is who the current content is for.
	RecipientName string `json:"recipientName"`
	// Revising says an issued document has its next revision drafted.
	Revising   bool   `json:"revising,omitempty"`
	ShareToken string `json:"shareToken,omitempty"`
}

func summaryOf(d *Document) Summary {
	s := Summary{
		ID: d.ID, Type: d.Type, Status: d.Status, Number: d.Number, Revision: d.Revision, ClientID: d.ClientID,
		Revising: d.Status == StatusIssued && d.Draft != nil, ShareToken: d.ShareToken,
	}
	c := d.Content
	if c == nil {
		c = d.Draft
	}
	if c != nil {
		s.Date, s.TotalCents, s.RecipientName = c.Date, c.TotalCents, c.Recipient.Name
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
}

func viewOf(tx *txn.Tx, d *Document) (*View, error) {
	if d == nil {
		return nil, nil
	}
	v := &View{
		Summary: summaryOf(d), Content: d.Content, Draft: d.Draft, CreatedAt: d.CreatedAt,
		IssuedAt: d.IssuedAt, CancelledAt: d.CancelledAt, CancelReason: d.CancelReason, Revisions: []Revision{},
	}
	if d.Draft != nil && !d.Issued() {
		cfg, err := settings.Get(tx)
		if err != nil {
			return nil, err
		}
		client, err := clients.Clients.Get(tx, d.ClientID)
		if err != nil {
			return nil, err
		}
		filled := Fill(*d.Draft, cfg, *client)
		v.Draft = &filled
	}
	revs, err := Revisions.WithRef(tx, d.ID)
	for _, r := range revs {
		v.Revisions = append(v.Revisions, *r)
	}
	return v, err
}

// SharedView is what a share link shows: the issued content, never a
// draft or a revision in progress (see cmd/public).
type SharedView struct {
	Type        Type       `json:"type"`
	Status      Status     `json:"status"`
	Number      string     `json:"number"`
	Revision    *int       `json:"revision,omitempty"`
	Content     Content    `json:"content"`
	CancelledAt *time.Time `json:"cancelledAt,omitempty"`
}

// SharedViewOf is an opened document as its link shows it (see Open).
func SharedViewOf(d *Document) SharedView {
	return SharedView{Type: d.Type, Status: d.Status, Number: d.Number, Revision: d.Revision, Content: *d.Content, CancelledAt: d.CancelledAt}
}

// searchRequest finds documents of a type by words in their number, who
// they are for or the client's name, and by days (a draft without a date
// is on no day), clients and status; an empty filter takes every value.
type searchRequest struct {
	listing.Request
	Type      Type     `json:"type"`
	ClientIDs []string `json:"clientIds"`
	Statuses  []Status `json:"statuses"`
}

type clientRequest struct {
	ClientID string `json:"clientId"`
}

type idRequest struct {
	ID string `json:"id"`
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

type shareRequest struct {
	IDs []string `json:"ids"`
}

// Routes registers the documents' actions. checks are what other features
// hold a document to before it is issued (see Check).
func Routes(r *router.Router, run *txn.Runner, checks ...Check) {
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
			return viewOf(tx, d)
		})
	}

	// documents.search finds documents of a type, latest first, a page at
	// a time.
	r.Query("documents.search", router.Typed(func(ctx context.Context, in searchRequest) (any, error) {
		if _, ok := Types[in.Type]; !ok {
			return nil, apperr.Invalid("Unknown document type %q.", in.Type)
		}
		return txn.Read(ctx, run, func(tx *txn.Tx) (listing.Page[Summary], error) {
			// Document dates are days, filed as UTC.
			from, to, err := in.Span(time.UTC)
			if err != nil {
				return listing.Page[Summary]{}, err
			}
			l := txn.List{Tag: string(in.Type), From: from, To: to, Latest: true}
			if len(in.ClientIDs) == 1 {
				l = txn.List{Client: in.ClientIDs[0], From: from, To: to, Latest: true}
			}
			words := in.Words()
			return listing.Read(tx, Documents, l, in.Request, func(d *Document) (Summary, bool, error) {
				if d.Type != in.Type || !listing.OneOf(in.ClientIDs, d.ClientID) || !listing.OneOf(in.Statuses, d.Status) {
					return Summary{}, false, nil
				}
				s := summaryOf(d)
				client, err := clients.Clients.Get(tx, d.ClientID)
				if err != nil {
					return Summary{}, false, err
				}
				return s, words.In(s.Number, s.RecipientName, client.Name), nil
			})
		})
	}))
	// documents.listByClient lists a client's documents of every type,
	// newest first, the drafts not issued yet last.
	r.Query("documents.listByClient", router.Typed(func(ctx context.Context, in clientRequest) (any, error) {
		return txn.Read(ctx, run, func(tx *txn.Tx) ([]Summary, error) {
			all, err := Documents.OfClient(tx, in.ClientID)
			out := summaries(all)
			draft := func(s Summary) int {
				if s.Number == "" {
					return 1
				}
				return 0
			}
			slices.SortStableFunc(out, func(a, b Summary) int {
				return cmp.Or(cmp.Compare(draft(a), draft(b)), cmp.Compare(b.Date, a.Date))
			})
			return out, err
		})
	}))
	r.Query("documents.get", router.Typed(func(ctx context.Context, in idRequest) (any, error) {
		return txn.Read(ctx, run, func(tx *txn.Tx) (*View, error) {
			d, err := Documents.Get(tx, in.ID)
			if err != nil {
				return nil, err
			}
			return viewOf(tx, d)
		})
	}))
	r.Mutation("documents.saveDraft", router.Typed(func(ctx context.Context, in saveDraftRequest) (any, error) {
		return step(ctx, func(tx *txn.Tx) (*Document, error) { return SaveDraft(tx, in.ID, in.Content) })
	}))
	r.Mutation("documents.issue", router.Typed(func(ctx context.Context, in idRequest) (any, error) {
		return step(ctx, func(tx *txn.Tx) (*Document, error) { return Issue(tx, in.ID, checks...) })
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

func summaries(all []*Document) []Summary {
	out := []Summary{}
	for _, d := range all {
		out = append(out, summaryOf(d))
	}
	return out
}
