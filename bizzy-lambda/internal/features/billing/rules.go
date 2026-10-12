// Package billing derives everything about sessions and packages that is not
// written in the calendar: which client, what fee, which package credit,
// where it happened, and each client's monthly activity. The rules here are
// pure; Reconciler loads, applies and writes them.
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
)

// Env is what derivation depends on besides the session itself.
type Env struct {
	Aliases     calendar.Aliases
	Clients     map[string]clients.Client
	HomeColorID string
	Location    *time.Location
}

func NewEnv(all []clients.Client, homeColorID string, loc *time.Location) Env {
	byID := make(map[string]clients.Client, len(all))
	for _, c := range all {
		byID[c.ID] = c
	}
	return Env{Aliases: calendar.AliasesOf(all), Clients: byID, HomeColorID: homeColorID, Location: loc}
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
	out.Reason, out.Drift = "", ""

	title, err := calendar.ParseTitle(s.Title)
	out.Name = title.Name

	if err == nil {
		match := calendar.MatchName(title.Name, env.Aliases)
		switch match.Kind {
		case calendar.MatchExact:
			out.ClientID = match.ClientID
		case calendar.MatchNearMiss:
			out.SuggestedClientID = match.ClientID
		}
	}

	switch {
	case s.Removed:
		out.Status = sessions.StatusRemoved
	case err != nil:
		out.Status = sessions.StatusParseError
		out.Reason = err.Error()
	case title.Tentative:
		out.Status = sessions.StatusTentative
	case out.ClientID == "":
		out.Status = sessions.StatusUnmatched
		switch {
		case out.SuggestedClientID != "":
			out.Reason = fmt.Sprintf("Did you mean %s?", env.Clients[out.SuggestedClientID].Name)
		default:
			out.Reason = fmt.Sprintf("No client is called %q", title.Name)
		}
	}

	out.Location, out.LocationSource = location(out, env)
	return Entry{Session: out, Title: title}
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

// Allocate prices one client's sessions in date order:
//
//  1. an amount in the title is what she was paid;
//  2. otherwise the oldest package bought at or before the session with a
//     credit left covers it (a receipted session never takes a credit);
//  3. otherwise the client's default fee;
//  4. otherwise the fee is missing.
//
// It sets CreditsUsed on the packages it is given.
func Allocate(client clients.Client, entries []*Entry, pkgs []*packages.Package) {
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

		if fee := e.Title.FeeCents; fee != nil {
			s.Status, s.FeeSource, s.FeeCents, s.ValueCents = sessions.StatusPriced, sessions.FeeFromTitle, ptr(*fee), *fee
			continue
		}

		if s.Document == nil {
			if p := firstWithCredit(pkgs, s.Start); p != nil {
				s.Status, s.FeeSource, s.PackageID = sessions.StatusPackage, sessions.FeeFromPackage, p.ID
				s.ValueCents = p.ShareCents(p.CreditsUsed)
				p.CreditsUsed++
				continue
			}
		}

		if fee := client.DefaultFeeCents; fee != nil {
			s.Status, s.FeeSource, s.FeeCents, s.ValueCents = sessions.StatusPriced, sessions.FeeFromDefault, ptr(*fee), *fee
			continue
		}

		s.Status = sessions.StatusMissingFee
		s.Reason = fmt.Sprintf("No amount in the title, no package credit left and no default fee for %s", client.Name)
	}
}

func firstWithCredit(pkgs []*packages.Package, at time.Time) *packages.Package {
	for _, p := range pkgs {
		if !p.Removed && p.CreditsLeft() > 0 && !p.PurchasedAt.After(at) {
			return p
		}
	}
	return nil
}

// SessionDrift explains how a session now contradicts its issued receipt.
func SessionDrift(s sessions.Session, loc *time.Location) string {
	ref := s.Document
	if !ref.Issued() {
		return ""
	}
	switch {
	case s.Removed:
		return fmt.Sprintf("Removed from the calendar after receipt %s", ref.Number)
	case s.ClientID != ref.ClientID:
		return fmt.Sprintf("Now matches a different client than receipt %s", ref.Number)
	case ref.Date != "" && LocalDate(s.Start, loc) != ref.Date:
		return fmt.Sprintf("Moved to %s after receipt %s", LocalDate(s.Start, loc), ref.Number)
	}
	return ""
}

// PackageDrift explains how a calendar package contradicts its receipt.
func PackageDrift(p packages.Package) string {
	if p.Removed && p.Document.Issued() {
		return fmt.Sprintf("Removed from the calendar after receipt %s", p.Document.Number)
	}
	return ""
}

// Activity sums one client's sessions and packages by month.
func Activity(entries []*Entry, pkgs []*packages.Package, loc *time.Location) (map[string]clients.MonthActivity, *time.Time) {
	activity := map[string]clients.MonthActivity{}
	var last *time.Time

	for _, e := range entries {
		s := e.Session
		if !s.Status.Delivered() {
			continue
		}
		month := MonthKey(s.Start, loc)
		a := activity[month]

		earned := s.ValueCents
		var received int64
		if s.FeeCents != nil {
			received = *s.FeeCents
		}
		// What the receipt says beats what the calendar says.
		if s.Document.Issued() && s.Document.AmountCents != nil {
			earned, received = *s.Document.AmountCents, *s.Document.AmountCents
		}

		a.Sessions++
		a.EarnedCents += earned
		a.ReceivedCents += received
		if s.Location == sessions.LocationHome {
			a.HomeSessions++
			a.HomeEarnedCents += earned
		}
		activity[month] = a

		if last == nil || s.Start.After(*last) {
			last = ptr(s.Start)
		}
	}

	for _, p := range pkgs {
		if p.Removed {
			continue
		}
		month := MonthKey(p.PurchasedAt, loc)
		a := activity[month]
		price := p.PriceCents
		if p.Document.Issued() && p.Document.AmountCents != nil {
			price = *p.Document.AmountCents
		}
		a.ReceivedCents += price
		activity[month] = a
	}

	if len(activity) == 0 {
		activity = nil
	}
	return activity, last
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
