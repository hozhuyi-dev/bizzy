package packages

import (
	"context"
	"strings"
	"time"

	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/platform/dynamo"
	"bizzy-lambda/internal/router"
	"bizzy-lambda/internal/shared/money"
)

// HandlerStore is what the handlers read and write.
type HandlerStore interface {
	Get(ctx context.Context, id string) (Package, bool, error)
	List(ctx context.Context) ([]Package, error)
	ListOpen(ctx context.Context) ([]Package, error)
	Save(ctx context.Context, p Package) error
	SetPayment(ctx context.Context, p Package) error
	Delete(ctx context.Context, id string) (bool, error)
}

// AfterChange reallocates credits for the clients a package change touches,
// and re-derives the session that bought it (the same id) if there is one,
// whoever it belongs to now: a title may buy it again.
type AfterChange func(ctx context.Context, packageID string, clientIDs ...string) error

// Impact previews and checks what saving a package as next (nil deletes
// it) would bring on (see billing.PackageImpact): sessions that gain or
// lose its credits. clientFee is the usual fee she gives a client without
// one in the same save. The app wires billing's.
type Impact interface {
	Preview(ctx context.Context, id string, next *Package, clientFee *int64) (any, error)
	Check(ctx context.Context, id string, next *Package, clientFee *int64, confirmed bool) error
}

// SetClientFee gives a client with no usual fee one; a client with one
// keeps it.
type SetClientFee func(ctx context.Context, clientID string, cents int64) error

// Refresh applies what the calendar changed since the last sync on the
// events that bought these packages, so a change is made to the package as
// the calendar has it now.
type Refresh func(ctx context.Context, eventIDs ...string) error

type handler struct {
	repo         HandlerStore
	afterChange  AfterChange
	impact       Impact
	setClientFee SetClientFee
	refresh      Refresh
	now          func() time.Time
	loc          *time.Location
}

func Register(r *router.Router, repo HandlerStore, afterChange AfterChange, impact Impact, setClientFee SetClientFee, refresh Refresh, loc *time.Location, now func() time.Time) {
	h := handler{repo: repo, afterChange: afterChange, impact: impact, setClientFee: setClientFee, refresh: refresh, now: now, loc: loc}
	r.Query("packages.list", router.Typed(h.list))
	r.Query("packages.impact", router.Typed(h.preview))
	r.Mutation("packages.save", router.Typed(h.save))
	r.Mutation("packages.delete", router.Typed(h.delete))
	r.Mutation("packages.makeStandalone", router.Typed(h.makeStandalone))
}

type listInput struct {
	// All includes used-up packages; by default only open ones are listed.
	All bool `json:"all"`
}

func (h handler) list(ctx context.Context, in listInput) (any, error) {
	list := h.repo.ListOpen
	if in.All {
		list = h.repo.List
	}
	all, err := list(ctx)
	return Views(all, h.now()), err
}

type saveInput struct {
	ID          string    `json:"id"`
	ClientID    string    `json:"clientId"`
	Sessions    int       `json:"sessions"`
	PriceCents  int64     `json:"priceCents"`
	PurchasedAt time.Time `json:"purchasedAt"`
	Note        string    `json:"note"`
	// Paid records it as paid in full when she adds it, if she was paid
	// there and then. Later, payments.set records it.
	Paid *money.Input `json:"paid"`
	// Confirm says she saw what saving brings on (packages.impact) and
	// saves anyway.
	Confirm bool `json:"confirm"`
	// UpdatePayment moves what was paid for it to a new price, as what she
	// collected or refunded with the change.
	UpdatePayment bool `json:"updatePayment"`
	// ClientFeeCents gives its client a usual fee, when it has none and the
	// change leaves sessions without one (Impact.NeedsClientFee).
	ClientFeeCents *int64 `json:"clientFeeCents"`
}

// next is the package as saving it would store it, and the client it
// belonged to; a new one has no id yet. read reads the stored one: the
// preview reads it as it is, saving once the calendar's changes apply.
func (h handler) next(ctx context.Context, in saveInput, read func(ctx context.Context, id string) (Package, bool, error)) (Package, string, error) {
	switch {
	case in.ClientID == "":
		return Package{}, "", apperr.Invalid("client is required")
	case in.Sessions < 1 || in.Sessions > 1000:
		return Package{}, "", apperr.Invalid("sessions must be between 1 and 1000")
	case in.PriceCents < 0:
		return Package{}, "", apperr.Invalid("price can't be negative")
	case in.PurchasedAt.IsZero():
		return Package{}, "", apperr.Invalid("purchase date is required")
	}

	p := Package{ID: in.ID, Source: SourceApp}
	previousClient := ""
	if in.ID != "" {
		existing, found, err := read(ctx, in.ID)
		if err != nil {
			return Package{}, "", err
		}
		if !found {
			return Package{}, "", apperr.NotFound("package not found")
		}
		if err := existing.CanEdit(); err != nil {
			return Package{}, "", err
		}
		p, previousClient = existing, existing.ClientID
	}
	p.ClientID, p.Sessions, p.PriceCents = in.ClientID, in.Sessions, in.PriceCents
	p.PurchasedAt, p.Note = in.PurchasedAt.UTC(), strings.TrimSpace(in.Note)
	if in.UpdatePayment && p.Payment.Outdated(p.PriceCents) {
		p.Payment = repriced(p.Payment, p.PriceCents, h.now())
	}
	return p, previousClient, nil
}

// repriced is a payment moved to a new price (see payments.Repriced).
func repriced(paid *money.Payment, dueCents int64, now time.Time) *money.Payment {
	out := *paid
	out.AmountCents, out.DueCents, out.UpdatedAt = dueCents, dueCents, now.UTC()
	return &out
}

type previewInput struct {
	saveInput
	// Delete previews deleting the package with ID instead.
	Delete bool `json:"delete"`
}

// preview is what saving (or deleting) the package would bring on, for the
// form to show before she saves.
func (h handler) preview(ctx context.Context, in previewInput) (any, error) {
	if in.Delete {
		return h.impact.Preview(ctx, in.ID, nil, in.ClientFeeCents)
	}
	p, _, err := h.next(ctx, in.saveInput, h.repo.Get)
	if err != nil {
		return nil, err
	}
	return h.impact.Preview(ctx, in.ID, &p, in.ClientFeeCents)
}

// save creates or edits a package bought outside the calendar. Calendar
// packages are edited in the calendar.
func (h handler) save(ctx context.Context, in saveInput) (any, error) {
	p, previousClient, err := h.next(ctx, in, h.current)
	if err != nil {
		return nil, err
	}
	var payment *money.Payment
	if in.Paid != nil && p.Payment == nil {
		if payment, err = money.New(*in.Paid, p.PriceCents, p.PriceCents, h.now(), h.loc); err != nil {
			return nil, err
		}
	}
	if err := h.impact.Check(ctx, in.ID, &p, in.ClientFeeCents, in.Confirm); err != nil {
		return nil, err
	}
	// Every check is done: only writes follow.
	if err := h.giveClientFee(ctx, in.ClientFeeCents, p.ClientID, previousClient); err != nil {
		return nil, err
	}
	if p.ID == "" {
		p.ID = dynamo.NewID()
	}

	if err := h.repo.Save(ctx, p); err != nil {
		return nil, err
	}
	if payment != nil {
		p.Payment = payment
	}
	if payment != nil || (in.UpdatePayment && in.ID != "") {
		if err := h.repo.SetPayment(ctx, p); err != nil {
			return nil, err
		}
	}
	if err := h.afterChange(ctx, p.ID, p.ClientID, previousClient); err != nil {
		return nil, err
	}
	// The reconcile may have used its credits.
	if saved, found, err := h.repo.Get(ctx, p.ID); err != nil {
		return nil, err
	} else if found {
		p = saved
	}
	return p.View(h.now()), nil
}

type deleteInput struct {
	ID string `json:"id"`
	// Confirm says she saw what deleting brings on (packages.impact) and
	// deletes anyway.
	Confirm bool `json:"confirm"`
	// ClientFeeCents gives its client a usual fee, when it has none and
	// deleting leaves sessions without one (Impact.NeedsClientFee).
	ClientFeeCents *int64 `json:"clientFeeCents"`
}

// giveClientFee sets the usual fee she gave in the form on the package's
// clients without one, before the change: should the change then fail,
// the client keeps the fee she chose.
func (h handler) giveClientFee(ctx context.Context, cents *int64, clientIDs ...string) error {
	if cents == nil {
		return nil
	}
	if *cents <= 0 {
		return apperr.Invalid("the usual fee must be more than nothing")
	}
	for _, id := range clientIDs {
		if id != "" {
			if err := h.setClientFee(ctx, id, *cents); err != nil {
				return err
			}
		}
	}
	return nil
}

func (h handler) delete(ctx context.Context, in deleteInput) (any, error) {
	existing, found, err := h.current(ctx, in.ID)
	if err != nil {
		return nil, err
	}
	if !found {
		return nil, apperr.NotFound("package not found")
	}
	if err := existing.CanDelete(); err != nil {
		return nil, err
	}
	if err := h.impact.Check(ctx, in.ID, nil, in.ClientFeeCents, in.Confirm); err != nil {
		return nil, err
	}
	if err := h.giveClientFee(ctx, in.ClientFeeCents, existing.ClientID); err != nil {
		return nil, err
	}
	deleted, err := h.repo.Delete(ctx, in.ID)
	if err != nil {
		return nil, err
	}
	if !deleted {
		return nil, apperr.Conflict("cancel the documents for this package first")
	}
	return nil, h.afterChange(ctx, existing.ID, existing.ClientID)
}

type idInput struct {
	ID string `json:"id"`
}

// current reads a package once the calendar's changes to the event that
// may have bought it are applied: one whose event buys it again (one made
// standalone included) is linked again. When that changes it, the change
// is refused, as what she saw (and confirmed) is no longer what it is.
func (h handler) current(ctx context.Context, id string) (Package, bool, error) {
	before, found, err := h.repo.Get(ctx, id)
	if err != nil || !found || h.refresh == nil {
		return before, found, err
	}
	if err := h.refresh(ctx, id); err != nil {
		return Package{}, false, err
	}
	after, found, err := h.repo.Get(ctx, id)
	if err == nil && (!found || !dynamo.Same(before, after)) {
		err = apperr.Conflict("The calendar changed this package meanwhile. Check it, and try again.")
	}
	return after, found, err
}

// makeStandalone keeps a package the calendar no longer buys as one of the
// app's, with its credits, payment and documents.
func (h handler) makeStandalone(ctx context.Context, in idInput) (any, error) {
	p, found, err := h.current(ctx, in.ID)
	if err != nil {
		return nil, err
	}
	if !found {
		return nil, apperr.NotFound("package not found")
	}
	if err := p.CanMakeStandalone(); err != nil {
		return nil, err
	}
	p.Source, p.Unlinked = SourceApp, false
	if err := h.repo.Save(ctx, p); err != nil {
		return nil, err
	}
	return p.View(h.now()), h.afterChange(ctx, p.ID, p.ClientID)
}
