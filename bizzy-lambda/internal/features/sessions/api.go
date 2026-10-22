package sessions

import (
	"context"
	"time"

	"bizzy-lambda/internal/features/attachments"
	"bizzy-lambda/internal/features/clients"
	"bizzy-lambda/internal/features/documents"
	"bizzy-lambda/internal/features/packages"
	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/platform/blobstore"
	"bizzy-lambda/internal/platform/listing"
	"bizzy-lambda/internal/platform/router"
	"bizzy-lambda/internal/platform/txn"
)

// View is a session as the app shows it: the booking, what pays for it
// and was paid, what was recorded, what is left to do, and what each
// action would say now (Can).
type View struct {
	ID          string     `json:"id"`
	ClientID    string     `json:"clientId"`
	ClientName  string     `json:"clientName"`
	Start       time.Time  `json:"start"`
	End         time.Time  `json:"end"`
	Tentative   bool       `json:"tentative"`
	ConfirmedAt *time.Time `json:"confirmedAt,omitempty"`
	Location    Location   `json:"location"`
	// Hours is how long it is charged for, and Credits what package
	// credits pay of it.
	Hours   float64      `json:"hours"`
	Credits []CreditView `json:"credits"`
	// FeeCents is what its invoice charges; FeeTyped says it was entered
	// for it, rather than the client's usual fee.
	FeeCents  int64           `json:"feeCents"`
	FeeTyped  bool            `json:"feeTyped"`
	Invoice   *DocumentRef    `json:"invoice,omitempty"`
	Paid      *documents.Paid `json:"paid,omitempty"`
	Bought    *BoughtView     `json:"bought,omitempty"`
	OwedCents int64           `json:"owedCents"`
	Record    RecordView      `json:"record"`
	Todo      []Reason        `json:"todo"`
	// CancelledAt is when it was called off, and CancelReason why.
	CancelledAt  *time.Time `json:"cancelledAt,omitempty"`
	CancelReason string     `json:"cancelReason,omitempty"`
	Can          Can        `json:"can"`
}

// Hit is a session a search found, with the part of its notes that has
// the words when they were found there.
type Hit struct {
	View
	Excerpt string `json:"excerpt,omitempty"`
}

// CreditView is the hours of a session a package's credits pay for.
type CreditView struct {
	PackageID string  `json:"packageId"`
	Hours     float64 `json:"hours"`
}

func creditViews(cs []Credit) []CreditView {
	out := []CreditView{}
	for _, c := range cs {
		out = append(out, CreditView{PackageID: c.PackageID, Hours: hours(c.Minutes)})
	}
	return out
}

func hours(minutes int) float64 { return float64(minutes) / 60 }

// DocumentRef names a document a session is on.
type DocumentRef struct {
	ID     string `json:"id"`
	Number string `json:"number,omitempty"`
}

// BoughtView is the package bought in a session.
type BoughtView struct {
	ID         string `json:"id"`
	Hours      int    `json:"hours"`
	PriceCents int64  `json:"priceCents"`
	Paid       bool   `json:"paid"`
}

// RecordView is what was recorded on a session.
type RecordView struct {
	Summary  string `json:"summary"`
	HasNotes bool   `json:"hasNotes"`
	Files    int    `json:"files"`
}

// Can is what each action on a session would say now. Delete keeps the
// package bought in it; DeleteWithPackage deletes that too.
type Can struct {
	Update            apperr.Verdict `json:"update"`
	Record            apperr.Verdict `json:"record"`
	Pay               apperr.Verdict `json:"pay"`
	UndoPayment       apperr.Verdict `json:"undoPayment"`
	Cancel            apperr.Verdict `json:"cancel"`
	Delete            apperr.Verdict `json:"delete"`
	DeleteWithPackage apperr.Verdict `json:"deleteWithPackage"`
}

// FullView is a session with its notes, and what its update can't
// change, for its page.
type FullView struct {
	View
	Notes  string       `json:"notes"`
	Locked apperr.Locks `json:"locked"`
}

// Locks are what an update to a session can't change now.
func Locks(tx *txn.Tx, s *Session) (apperr.Locks, error) {
	return apperr.LocksOf(map[string]error{
		"clientId":  CanReassign(tx, s),
		"tentative": CanUnconfirm(tx, s),
		"fee":       CanReprice(tx, s),
		"package":   CanRebuy(tx, s),
	})
}

// CoverView is what would pay for a session being booked: the credits of
// packages bought before it, and what pays for the FeeHours they leave
// (Kind), at FeeCents when that is the usual fee.
type CoverView struct {
	Kind     CoverKind    `json:"kind"`
	Hours    float64      `json:"hours"`
	Credits  []CreditView `json:"credits"`
	FeeHours float64      `json:"feeHours"`
	FeeCents *int64       `json:"feeCents,omitempty"`
}

// ViewOf is a session as of now.
func ViewOf(tx *txn.Tx, s *Session) (View, error) {
	client, err := clients.Clients.Get(tx, s.ClientID)
	if err != nil {
		return View{}, err
	}
	v := View{
		ID: s.ID, ClientID: s.ClientID, ClientName: client.Name, Start: s.Start, End: s.End,
		Tentative: s.Tentative, ConfirmedAt: s.ConfirmedAt, Location: s.Location,
		Hours: hours(s.Billable()), Credits: creditViews(s.Credits),
		CancelledAt: s.CancelledAt, CancelReason: s.CancelReason,
	}
	inv, line, err := documents.Invoice(tx, s.Source())
	if err != nil {
		return View{}, err
	}
	if line != nil {
		v.FeeCents, v.FeeTyped, v.Invoice = line.AmountCents, line.Typed, &DocumentRef{ID: inv.ID, Number: inv.Number}
	}
	if v.Paid, err = documents.Received(tx, s.Source()); err != nil {
		return View{}, err
	}
	if p, err := packages.BoughtIn(tx, s.ID); err != nil {
		return View{}, err
	} else if p != nil {
		price, _, err := documents.Charged(tx, documents.PackageSource(p.ID))
		if err != nil {
			return View{}, err
		}
		paid, err := documents.Received(tx, documents.PackageSource(p.ID))
		if err != nil {
			return View{}, err
		}
		v.Bought = &BoughtView{ID: p.ID, Hours: p.Hours, PriceCents: price, Paid: paid != nil}
	}
	if v.OwedCents, err = owed(tx, s); err != nil {
		return View{}, err
	}
	if s.Record != nil {
		v.Record.Summary, v.Record.HasNotes = s.Record.Summary, s.Record.HasNotes
	}
	if v.Record.Files, err = attachments.Count(tx, attachments.OwnerSession, s.ID); err != nil {
		return View{}, err
	}
	v.Todo = s.Todo(v.OwedCents, tx.Now())
	for _, c := range []struct {
		verdict *apperr.Verdict
		check   error
	}{
		{&v.Can.Update, CanUpdate(s)},
		{&v.Can.Record, CanRecord(tx, s.ID)},
		{&v.Can.Pay, CanPay(tx, s)},
		{&v.Can.UndoPayment, CanUndoPayment(tx, s)},
		{&v.Can.Cancel, CanCancel(tx, s)},
		{&v.Can.Delete, CanDelete(tx, s)},
		{&v.Can.DeleteWithPackage, CanDeleteWithPackage(tx, s)},
	} {
		if *c.verdict, err = apperr.VerdictOf(c.check); err != nil {
			return View{}, err
		}
	}
	return v, nil
}

func viewsOf(tx *txn.Tx, ss []*Session) ([]View, error) {
	out := []View{}
	for _, s := range ss {
		v, err := ViewOf(tx, s)
		if err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, nil
}

type idRequest struct {
	ID string `json:"id"`
}

type listRequest struct {
	From time.Time `json:"from"`
	To   time.Time `json:"to"`
}

// searchRequest finds sessions by words in the client's name, the summary
// or the notes, and by days, clients, place and stage: what is left to do,
// or Cancelled; an empty filter takes every value.
type searchRequest struct {
	listing.Request
	ClientIDs []string   `json:"clientIds"`
	Locations []Location `json:"locations"`
	Todo      []Reason   `json:"todo"`
	Cancelled bool       `json:"cancelled"`
}

// stageOf reports whether a session is at one of the stages asked for.
func (in searchRequest) stageOf(v View) bool {
	if len(in.Todo) == 0 && !in.Cancelled {
		return true
	}
	return in.Cancelled && v.CancelledAt != nil || len(in.Todo) > 0 && listing.AnyOf(in.Todo, v.Todo)
}

type updateRequest struct {
	ID string `json:"id"`
	Fields
}

type cancelRequest struct {
	ID     string `json:"id"`
	Reason string `json:"reason"`
}

type deleteRequest struct {
	ID string `json:"id"`
	// KeepPackage keeps the package bought in it as one on its own.
	KeepPackage bool `json:"keepPackage"`
}

type recordRequest struct {
	ID      string `json:"id"`
	Summary string `json:"summary"`
	// Notes nil keeps the notes as they are: the to-do list writes only
	// the summary.
	Notes *string `json:"notes"`
}

type previewRequest struct {
	ClientID string `json:"clientId"`
	Time     Span   `json:"time"`
	// SessionID is the session being edited, if any.
	SessionID   string `json:"sessionId,omitempty"`
	BuysPackage bool   `json:"buysPackage"`
}

// Routes registers the sessions' actions; blobs holds their files.
func Routes(r *router.Router, run *txn.Runner, blobs blobstore.Store) {
	one := func(ctx context.Context, do func(tx *txn.Tx) (*Session, error)) (any, error) {
		return txn.Run(ctx, run, func(tx *txn.Tx) (any, error) {
			s, err := do(tx)
			if err != nil {
				return nil, err
			}
			return ViewOf(tx, s)
		})
	}

	// sessions.list lists the sessions starting in [from, to), a year at
	// most.
	r.Query("sessions.list", router.Typed(func(ctx context.Context, in listRequest) (any, error) {
		if in.From.IsZero() || !in.To.After(in.From) || in.To.Sub(in.From) > 400*24*time.Hour {
			return nil, apperr.Invalid("Ask for a stretch of at most a year, from before to.")
		}
		return txn.Read(ctx, run, func(tx *txn.Tx) ([]View, error) {
			ss, err := Sessions.Between(tx, in.From, in.To.Add(-time.Second))
			if err != nil {
				return nil, err
			}
			return viewsOf(tx, ss)
		})
	}))
	// sessions.search finds sessions, latest first, a page at a time.
	r.Query("sessions.search", router.Typed(func(ctx context.Context, in searchRequest) (any, error) {
		return txn.Read(ctx, run, func(tx *txn.Tx) (listing.Page[Hit], error) {
			from, to, err := in.Span(tx.Location())
			if err != nil {
				return listing.Page[Hit]{}, err
			}
			l := txn.List{From: from, To: to, Latest: true}
			if len(in.ClientIDs) == 1 {
				l.Client = in.ClientIDs[0]
			}
			words := in.Words()
			return listing.Read(tx, Sessions, l, in.Request, func(s *Session) (Hit, bool, error) {
				if !listing.OneOf(in.ClientIDs, s.ClientID) || !listing.OneOf(in.Locations, s.Location) {
					return Hit{}, false, nil
				}
				excerpt, found, err := Search(tx, s, words)
				if err != nil || !found {
					return Hit{}, false, err
				}
				v, err := ViewOf(tx, s)
				return Hit{View: v, Excerpt: excerpt}, err == nil && in.stageOf(v), err
			})
		})
	}))
	r.Query("sessions.get", router.Typed(func(ctx context.Context, in idRequest) (any, error) {
		return txn.Read(ctx, run, func(tx *txn.Tx) (FullView, error) {
			s, err := Sessions.Get(tx, in.ID)
			if err != nil {
				return FullView{}, err
			}
			v, err := ViewOf(tx, s)
			if err != nil {
				return FullView{}, err
			}
			notes, err := NotesOf(tx, s.ID)
			if err != nil {
				return FullView{}, err
			}
			locked, err := Locks(tx, s)
			return FullView{View: v, Notes: notes, Locked: locked}, err
		})
	}))
	r.Query("sessions.preview", router.Typed(func(ctx context.Context, in previewRequest) (any, error) {
		return txn.Read(ctx, run, func(tx *txn.Tx) (CoverView, error) {
			c, err := Preview(tx, in.ClientID, in.Time, in.SessionID, in.BuysPackage)
			return CoverView{
				Kind: c.Kind, Hours: hours(c.Minutes), Credits: creditViews(c.Credits),
				FeeHours: hours(c.FeeMinutes), FeeCents: c.FeeCents,
			}, err
		})
	}))
	r.Mutation("sessions.create", router.Typed(func(ctx context.Context, in Fields) (any, error) {
		return one(ctx, func(tx *txn.Tx) (*Session, error) { return Create(tx, in) })
	}))
	r.Mutation("sessions.update", router.Typed(func(ctx context.Context, in updateRequest) (any, error) {
		return one(ctx, func(tx *txn.Tx) (*Session, error) { return Update(tx, in.ID, in.Fields) })
	}))
	r.Mutation("sessions.saveRecord", router.Typed(func(ctx context.Context, in recordRequest) (any, error) {
		return one(ctx, func(tx *txn.Tx) (*Session, error) { return SaveRecord(tx, in.ID, in.Summary, in.Notes) })
	}))
	r.Mutation("sessions.cancel", router.Typed(func(ctx context.Context, in cancelRequest) (any, error) {
		return one(ctx, func(tx *txn.Tx) (*Session, error) { return Cancel(tx, in.ID, in.Reason) })
	}))
	r.Mutation("sessions.delete", router.Typed(func(ctx context.Context, in deleteRequest) (any, error) {
		keys, err := txn.Run(ctx, run, func(tx *txn.Tx) ([]string, error) { return Delete(tx, in.ID, in.KeepPackage) })
		if err != nil {
			return nil, err
		}
		attachments.DeleteFiles(ctx, blobs, keys...)
		return nil, nil
	}))
}

// Search reports whether every word is in the session's client's names,
// its summary or its notes, and the excerpt of the notes that has them
// when they were needed. The notes are read only then: they are long.
func Search(tx *txn.Tx, s *Session, words listing.Words) (excerpt string, found bool, err error) {
	if len(words) == 0 {
		return "", true, nil
	}
	client, err := clients.Clients.Get(tx, s.ClientID)
	if err != nil {
		return "", false, err
	}
	fields := append([]string{client.Name}, client.Aliases...)
	if s.Record != nil {
		fields = append(fields, s.Record.Summary)
	}
	if words.In(fields...) {
		return "", true, nil
	}
	if s.Record == nil || !s.Record.HasNotes {
		return "", false, nil
	}
	notes, err := NotesOf(tx, s.ID)
	if err != nil || !words.In(append(fields, notes)...) {
		return "", false, err
	}
	return words.Excerpt(notes), true, nil
}
