package book

import (
	"slices"
	"time"

	"bizzy-lambda/internal/features/clients"
	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/shared/money"
)

// Activity sums one client's sessions and packages by month, and finds
// their last session and next booking, as of now.
//
// Earned values sessions in the month they happen, confirmed and started (a
// session on a credit at its share of the package). Received is money in the
// month it was paid, as the receipts say.
func (b *Book) Activity(clientID string) (activity map[string]clients.MonthActivity, last, next *time.Time) {
	activity = map[string]clients.MonthActivity{}
	add := func(month string, f func(*clients.MonthActivity)) {
		a := activity[month]
		f(&a)
		activity[month] = a
	}
	received := func(p *money.Paid) {
		if p == nil {
			return
		}
		day, _ := time.ParseInLocation(time.DateOnly, p.PaidOn, b.Location)
		add(b.month(day), func(a *clients.MonthActivity) { a.ReceivedCents += p.AmountCents })
	}

	for _, s := range b.ClientSessions(clientID) {
		received(s.Paid)
		if s.Start.After(b.Now) {
			if next == nil || s.Start.Before(*next) {
				next = ptr(s.Start)
			}
			continue
		}
		if s.Tentative {
			continue
		}
		value := b.value(s)
		add(b.month(s.Start), func(a *clients.MonthActivity) {
			a.Sessions++
			a.EarnedCents += value
			if s.Location == sessions.LocationVisit {
				a.HomeSessions++
				a.HomeEarnedCents += value
			}
		})
		if last == nil || s.Start.After(*last) {
			last = ptr(s.Start)
		}
	}
	for _, p := range b.ClientPackages(clientID) {
		received(p.Paid)
	}
	if len(activity) == 0 {
		activity = nil
	}
	return activity, last, next
}

// value is what a session earned: its fee, or its share of the package
// whose credit covers it.
func (b *Book) value(s *sessions.Session) int64 {
	if !s.OnCredit() {
		return s.FeeCents
	}
	p, ok := b.Packages[s.PackageID]
	if !ok {
		return 0
	}
	i := slices.IndexFunc(b.Using(p.ID), func(u *sessions.Session) bool { return u.ID == s.ID })
	return p.ShareCents(i)
}

func (b *Book) month(t time.Time) string {
	return t.In(b.Location).Format("2006-01")
}
