// Package billing derives everything about sessions and packages that is not
// written in the calendar: which client, what fee, which package credit,
// where it happened, whether it is still ahead, and each client's monthly
// activity. The rules here are pure; Reconciler loads, applies and writes
// them.
package billing

import (
	"cmp"
	"fmt"
	"slices"
	"time"

	"bizzy-lambda/internal/features/calendar"
	"bizzy-lambda/internal/features/clients"
	"bizzy-lambda/internal/features/packages"
	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/features/settings"
	"bizzy-lambda/internal/shared/docref"
	"bizzy-lambda/internal/shared/money"
)

// Env is what derivation depends on besides the session itself.
type Env struct {
	Aliases     clients.Aliases
	Clients     map[string]clients.Client
	HomeColorID string
	Location    *time.Location
	Now         time.Time
}

func NewEnv(all []clients.Client, cfg settings.Settings, loc *time.Location, now time.Time) Env {
	byID := make(map[string]clients.Client, len(all))
	for _, c := range all {
		byID[c.ID] = c
	}
	return Env{Aliases: clients.AliasesOf(all), Clients: byID, HomeColorID: cfg.HomeVisitColorID, Location: loc, Now: now}
}

// Entry is a session with its parsed title, carried between the steps.
type Entry struct {
	Session sessions.Session
	Title   calendar.Title
}

// allocatable reports whether the session still needs a fee: Derive left
// its status open for Allocate.
func (e Entry) allocatable() bool {
	return e.Session.Status == ""
}

// Derive re-reads a session's title against the current clients and
// settings. It decides every status except the fee-based ones (priced,
// package, missing_fee), which Allocate settles; for those it leaves Status
// empty.
func Derive(s sessions.Session, env Env) Entry {
	out := s
	out.Status, out.Name, out.ClientID, out.SuggestedClientID = "", "", "", ""
	out.FeeCents, out.FeeSource, out.PackageID, out.ValueCents = nil, "", "", 0
	out.BoughtCents, out.BoughtSettled, out.BoughtDocumented = 0, false, false
	out.Reason, out.Drift = "", ""
	out.Upcoming = s.RemovedAt == nil && s.Start.After(env.Now)

	title, err := calendar.ParseTitle(s.Title)
	out.Name = title.Name

	if err == nil {
		match := clients.MatchName(title.Name, env.Aliases)
		switch match.Kind {
		case clients.MatchExact:
			out.ClientID = match.ClientID
		case clients.MatchNearMiss:
			out.SuggestedClientID = match.ClientID
		}
		switch {
		case title.Tentative:
			out.ConfirmedAt = nil
		case out.ConfirmedAt == nil:
			// First seen confirmed: now, or its start for history.
			at := env.Now.UTC()
			if s.Start.Before(at) {
				at = s.Start.UTC()
			}
			out.ConfirmedAt = &at
		}
	}

	switch {
	case s.RemovedAt != nil:
		out.Status = sessions.StatusRemoved
	case err != nil:
		out.Status = sessions.StatusParseError
		out.Reason = err.Error()
	case title.Tentative:
		out.Status = sessions.StatusTentative
		if out.ClientID == "" {
			out.Reason = unmatched(out, title, env)
		}
	case out.ClientID == "":
		out.Status = sessions.StatusUnmatched
		out.Reason = unmatched(out, title, env)
	}

	out.Location, out.LocationSource = location(out, env)
	return Entry{Session: out, Title: title}
}

// unmatched says why no client matched the title's name.
func unmatched(s sessions.Session, title calendar.Title, env Env) string {
	if s.SuggestedClientID != "" {
		return fmt.Sprintf("Did you mean %s?", env.Clients[s.SuggestedClientID].Name)
	}
	return fmt.Sprintf("No client is called %q", title.Name)
}

// location: the event colour wins when set; otherwise the client's habit.
func location(s sessions.Session, env Env) (sessions.Location, string) {
	switch {
	case s.ColorID != "" && s.ColorID == env.HomeColorID:
		return sessions.LocationHome, "colour"
	case s.ColorID != "":
		return sessions.LocationClinic, "colour"
	case env.Clients[s.ClientID].HomeVisits:
		return sessions.LocationHome, "client"
	default:
		return sessions.LocationClinic, "client"
	}
}

// CalendarPackage is the package a session's title buys, if any.
func CalendarPackage(e Entry) (packages.Package, bool) {
	if !e.allocatable() || e.Title.Package == nil {
		return packages.Package{}, false
	}
	return packages.Package{
		ID:          e.Session.EventID,
		ClientID:    e.Session.ClientID,
		Sessions:    e.Title.Package.Sessions,
		PriceCents:  e.Title.Package.PriceCents,
		PurchasedAt: e.Session.Start,
		Source:      packages.SourceCalendar,
	}, true
}

// Allocate prices one client's sessions in date order, booked ones
// included (a booking holds its credit):
//
//  1. an amount in the title is the fee;
//  2. otherwise the oldest package bought at or before the session with a
//     credit left covers it (one already paid or on a document keeps its
//     fee rather than switch to a credit);
//  3. otherwise the client's fee on the session's day (clients.Client.FeeOn);
//  4. otherwise the fee is missing.
//
// A package bought in the session is collected with it: the session
// mirrors its price and whether it is settled. It sets CreditsUsed on the
// packages it is given.
func Allocate(client clients.Client, entries []*Entry, pkgs []*packages.Package, loc *time.Location) {
	slices.SortFunc(entries, func(a, b *Entry) int {
		return cmp.Or(a.Session.Start.Compare(b.Session.Start), cmp.Compare(a.Session.EventID, b.Session.EventID))
	})
	slices.SortFunc(pkgs, func(a, b *packages.Package) int {
		return cmp.Or(a.PurchasedAt.Compare(b.PurchasedAt), cmp.Compare(a.ID, b.ID))
	})
	for _, p := range pkgs {
		p.CreditsUsed = 0
	}

	for _, e := range entries {
		if !e.allocatable() {
			continue
		}
		s := &e.Session
		if p := e.Title.Package; p != nil {
			s.BoughtCents = p.PriceCents
			if bought := find(pkgs, s.EventID); bought != nil {
				s.BoughtSettled, s.BoughtDocumented = bought.Settled(), bought.HasDocuments()
			}
		}

		if fee := e.Title.FeeCents; fee != nil {
			s.Status, s.FeeSource, s.FeeCents, s.ValueCents = sessions.StatusPriced, sessions.FeeFromTitle, ptr(*fee), *fee
			continue
		}

		if !s.HasDocuments() && s.Payment == nil {
			if p := firstWithCredit(pkgs, s.Start); p != nil {
				s.Status, s.FeeSource, s.PackageID = sessions.StatusPackage, sessions.FeeFromPackage, p.ID
				s.ValueCents = p.ShareCents(p.CreditsUsed)
				p.CreditsUsed++
				continue
			}
		}

		if fee := client.FeeOn(LocalDate(s.Start, loc)); fee != nil {
			s.Status, s.FeeSource, s.FeeCents, s.ValueCents = sessions.StatusPriced, sessions.FeeFromDefault, ptr(*fee), *fee
			continue
		}

		s.Status = sessions.StatusMissingFee
		s.Reason = fmt.Sprintf("No amount in the title, no package credit left and no fee set for %s", client.Name)
	}
}

func find(pkgs []*packages.Package, id string) *packages.Package {
	for _, p := range pkgs {
		if p.ID == id {
			return p
		}
	}
	return nil
}

func firstWithCredit(pkgs []*packages.Package, at time.Time) *packages.Package {
	for _, p := range pkgs {
		if p.CreditsLeft() > 0 && !p.PurchasedAt.After(at) {
			return p
		}
	}
	return nil
}

// SessionDrift explains how a session now contradicts an issued document
// covering it.
func SessionDrift(s sessions.Session, loc *time.Location) string {
	for _, slot := range docref.Slots {
		ref := s.Ref(slot)
		if !ref.Issued() {
			continue
		}
		label := fmt.Sprintf("%s %s", slot, ref.Number)
		switch {
		case s.RemovedAt != nil:
			return fmt.Sprintf("Deleted from the calendar after %s", label)
		case s.ClientID != ref.ClientID:
			return fmt.Sprintf("Now matches a different client than %s", label)
		case ref.Date != "" && LocalDate(s.Start, loc) != ref.Date:
			return fmt.Sprintf("Moved to %s after %s", LocalDate(s.Start, loc), label)
		case ref.FeeCents != nil && s.Status.Delivered() && s.DueCents() != *ref.FeeCents:
			return fmt.Sprintf("The fee is now %s, not %s as when %s was issued", money.Format(s.DueCents()), money.Format(*ref.FeeCents), label)
		}
	}
	return ""
}

// PackageDrift explains how a package now contradicts an issued document
// covering it: the event that bought it names another client, or moved.
func PackageDrift(p packages.Package, loc *time.Location) string {
	for _, slot := range docref.Slots {
		ref := p.Ref(slot)
		if !ref.Issued() {
			continue
		}
		label := fmt.Sprintf("%s %s", slot, ref.Number)
		switch {
		case p.ClientID != ref.ClientID:
			return fmt.Sprintf("Now belongs to a different client than %s", label)
		case ref.Date != "" && LocalDate(p.PurchasedAt, loc) != ref.Date:
			return fmt.Sprintf("Bought on %s after %s", LocalDate(p.PurchasedAt, loc), label)
		case ref.FeeCents != nil && p.PriceCents != *ref.FeeCents:
			return fmt.Sprintf("The price is now %s, not %s as when %s was issued", money.Format(p.PriceCents), money.Format(*ref.FeeCents), label)
		}
	}
	return ""
}

// Activity sums one client's sessions and packages by month, and finds
// their last session and next booking.
//
// Earned values sessions in the month they happen (a package session at its
// share). Received is money in the month it was paid, as she recorded it on
// sessions and packages.
func Activity(entries []*Entry, pkgs []*packages.Package, loc *time.Location) (activity map[string]clients.MonthActivity, last, next *time.Time) {
	activity = map[string]clients.MonthActivity{}
	add := func(month string, f func(*clients.MonthActivity)) {
		a := activity[month]
		f(&a)
		activity[month] = a
	}

	for _, e := range entries {
		s := e.Session
		if s.RemovedAt != nil {
			continue
		}
		if s.Upcoming {
			if next == nil || s.Start.Before(*next) {
				next = ptr(s.Start)
			}
		}

		if s.Payment.IsPaid() {
			received(add, s.Payment, loc)
		}

		if !s.Status.Delivered() || s.Upcoming {
			continue
		}
		add(MonthKey(s.Start, loc), func(a *clients.MonthActivity) {
			a.Sessions++
			a.EarnedCents += s.ValueCents
			if s.Location == sessions.LocationHome {
				a.HomeSessions++
				a.HomeEarnedCents += s.ValueCents
			}
		})
		if last == nil || s.Start.After(*last) {
			last = ptr(s.Start)
		}
	}

	for _, p := range pkgs {
		if p.Payment.IsPaid() {
			received(add, p.Payment, loc)
		}
	}

	if len(activity) == 0 {
		activity = nil
	}
	return activity, last, next
}

// received adds a payment to the month it was paid in.
func received(add func(string, func(*clients.MonthActivity)), p *money.Payment, loc *time.Location) {
	day, _ := time.ParseInLocation(time.DateOnly, p.PaidOn, loc)
	add(MonthKey(day, loc), func(a *clients.MonthActivity) { a.ReceivedCents += p.AmountCents })
}

// MonthKey is the month a time falls in, in her time zone.
func MonthKey(t time.Time, loc *time.Location) string {
	return t.In(loc).Format("2006-01")
}

// LocalDate is the day a time falls on, in her time zone.
func LocalDate(t time.Time, loc *time.Location) string {
	return t.In(loc).Format(time.DateOnly)
}

func ptr[T any](v T) *T { return &v }
