// Package activity sums each client's sessions and money by month, and
// finds where each client stands: their last session and next booking,
// what they owe and have left on packages, their follow-ups, when they
// were last in touch, and whether they have lapsed. It is what the
// clients list and the business metrics read, worked out when asked for
// from the sessions, documents and follow-ups, so it is never out of date.
package activity

import (
	"cmp"
	"slices"
	"time"

	"bizzy-lambda/internal/features/documents"
	"bizzy-lambda/internal/features/followups"
	"bizzy-lambda/internal/features/packages"
	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/platform/txn"
)

// Month sums one client's sessions in a month.
type Month struct {
	Sessions     int `json:"sessions"`
	HomeSessions int `json:"homeSessions,omitempty"`
	// ReceivedCents is money paid that month, as the receipts say.
	ReceivedCents int64 `json:"receivedCents"`
	// EarnedCents values the sessions that happened that month, confirmed:
	// what package credits pay of one at its share of the package's price.
	EarnedCents     int64 `json:"earnedCents"`
	HomeEarnedCents int64 `json:"homeEarnedCents,omitempty"`
}

// Client is one client's activity, by month ("2026-10", in the user's
// time zone), and where they stand now.
type Client struct {
	ClientID      string           `json:"clientId"`
	Months        map[string]Month `json:"months"`
	LastSessionAt *time.Time       `json:"lastSessionAt,omitempty"`
	NextBookedAt  *time.Time       `json:"nextBookedAt,omitempty"`
	// LastSummary is the summary of the latest session that has one: what
	// the client is being seen for, lately.
	LastSummary string `json:"lastSummary,omitempty"`
	// Unrecorded counts the sessions that happened with no summary yet.
	Unrecorded int `json:"unrecorded,omitempty"`
	// OwedCents is what their invoices charge that no receipt pays.
	OwedCents int64 `json:"owedCents,omitempty"`
	// CreditsLeftMinutes is what their packages have left, booked
	// sessions taken off.
	CreditsLeftMinutes int `json:"creditsLeftMinutes,omitempty"`
	// CreditsLeftCents is what those credits are worth, at their share of
	// each package's price.
	CreditsLeftCents int64 `json:"creditsLeftCents,omitempty"`
	// SharedCreditsLeftMinutes is what packages shared with them have
	// left: their holders' credits, counted there too, so never added to
	// CreditsLeftMinutes.
	SharedCreditsLeftMinutes int `json:"sharedCreditsLeftMinutes,omitempty"`
	// OpenFollowUps counts the follow-ups not done; NextFollowUpAt is when
	// the soonest is due (it may be past).
	OpenFollowUps  int        `json:"openFollowUps,omitempty"`
	NextFollowUpAt *time.Time `json:"nextFollowUpAt,omitempty"`
	// LastContactedAt is the user's latest contact with them: a session
	// that happened, or a follow-up done (see followups.ContactedAt).
	// Issuing or sending a document isn't contact.
	LastContactedAt *time.Time `json:"lastContactedAt,omitempty"`
	// LapsedMonths is the longest of LapseMonths they have lapsed for
	// (see Lapsed); 0 when they haven't.
	LapsedMonths int `json:"lapsedMonths,omitempty"`
}

// LapseMonths are the spans the Reconnect list can ask for.
var LapseMonths = []int{3, 6, 12}

// ContactSnoozeDays is how long getting in touch keeps a client off the
// Reconnect list.
const ContactSnoozeDays = 30

// Lapsed reports whether the client is worth getting back in touch with
// after months: they had sessions, none in that long, nothing booked, no
// follow-up waiting, and no contact in ContactSnoozeDays.
func (c Client) Lapsed(months int, now time.Time, loc *time.Location) bool {
	switch {
	case c.LastSessionAt == nil, c.NextBookedAt != nil, c.OpenFollowUps > 0:
		return false
	case c.LastContactedAt != nil && now.Sub(*c.LastContactedAt) < ContactSnoozeDays*24*time.Hour:
		return false
	}
	return monthsBetween(c.LastSessionAt.In(loc), now.In(loc)) >= months
}

// monthsBetween is how many whole months have passed from one day to
// another.
func monthsBetween(from, to time.Time) int {
	months := (to.Year()-from.Year())*12 + int(to.Month()-from.Month())
	if to.Day() < from.Day() {
		months--
	}
	return max(months, 0)
}

// All is every client's activity as of now.
func All(tx *txn.Tx) ([]Client, error) {
	invoices, err := documents.Documents.Tagged(tx, string(documents.TypeInvoice))
	if err != nil {
		return nil, err
	}
	charged := lineAmounts(invoices)
	byClient := map[string]*Client{}
	of := func(id string) *Client {
		c, ok := byClient[id]
		if !ok {
			c = &Client{ClientID: id, Months: map[string]Month{}}
			byClient[id] = c
		}
		return c
	}
	add := func(clientID, month string, f func(*Month)) {
		c := of(clientID)
		m := c.Months[month]
		f(&m)
		c.Months[month] = m
	}
	latest := func(at **time.Time, t time.Time) {
		if *at == nil || t.After(**at) {
			*at = &t
		}
	}
	soonest := func(at **time.Time, t time.Time) {
		if *at == nil || t.Before(**at) {
			*at = &t
		}
	}

	receipts, err := documents.Documents.Tagged(tx, string(documents.TypeReceipt))
	if err != nil {
		return nil, err
	}
	for _, d := range receipts {
		c := d.Counting()
		if c == nil {
			continue
		}
		// Each in the month it was paid: a receipt may record several payments.
		for _, line := range c.Lines {
			if line.Payment == nil {
				continue
			}
			day, _ := time.Parse(time.DateOnly, line.Payment.PaidOn)
			cents := line.AmountCents
			add(d.ClientID, day.Format("2006-01"), func(m *Month) { m.ReceivedCents += cents })
		}
	}

	if err := addOwed(tx, invoices, charged, of); err != nil {
		return nil, err
	}

	all, err := sessions.Sessions.All(tx)
	if err != nil {
		return nil, err
	}
	slices.SortFunc(all, func(a, b *sessions.Session) int { return cmp.Or(a.Start.Compare(b.Start), cmp.Compare(a.ID, b.ID)) })
	credit := map[string]int{} // minutes of each package's credits used so far, in session order
	now := tx.Now()
	for _, s := range all {
		if s.Cancelled() {
			continue // It holds no time, and costs nothing.
		}
		c := of(s.ClientID)
		if s.Start.After(now) {
			soonest(&c.NextBookedAt, s.Start)
			for _, cr := range s.Credits {
				credit[cr.PackageID] += cr.Minutes
			}
			continue
		}
		value := charged[s.Source()]
		for _, cr := range s.Credits {
			p, ok, err := packages.Packages.Find(tx, cr.PackageID)
			if err != nil {
				return nil, err
			}
			if ok {
				value += p.ShareCents(charged[documents.PackageSource(p.ID)], credit[p.ID], cr.Minutes)
			}
			credit[cr.PackageID] += cr.Minutes
		}
		if s.Tentative {
			continue
		}
		visit := s.Location == sessions.LocationVisit
		add(s.ClientID, s.Start.In(tx.Location()).Format("2006-01"), func(m *Month) {
			m.Sessions++
			m.EarnedCents += value
			if visit {
				m.HomeSessions++
				m.HomeEarnedCents += value
			}
		})
		latest(&c.LastSessionAt, s.Start)
		if s.Recorded() {
			c.LastSummary = s.Record.Summary // in session order, so the latest wins
		}
		if slices.Contains(s.Todo(0, now), sessions.ReasonRecord) {
			c.Unrecorded++
		}
		if s.Happened(now) {
			latest(&c.LastContactedAt, s.End)
		}
	}

	pkgs, err := packages.Packages.All(tx)
	if err != nil {
		return nil, err
	}
	for _, p := range pkgs {
		if left := p.Hours*60 - credit[p.ID]; left > 0 {
			c := of(p.ClientID)
			c.CreditsLeftMinutes += left
			c.CreditsLeftCents += p.ShareCents(charged[documents.PackageSource(p.ID)], credit[p.ID], left)
			for _, id := range p.SharedWith {
				of(id).SharedCreditsLeftMinutes += left
			}
		}
	}

	fus, err := followups.FollowUps.All(tx)
	if err != nil {
		return nil, err
	}
	for _, fu := range fus {
		c := of(fu.ClientID)
		if fu.DoneAt != nil {
			latest(&c.LastContactedAt, fu.ContactedAt())
			continue
		}
		c.OpenFollowUps++
		soonest(&c.NextFollowUpAt, fu.Due)
	}

	out := make([]Client, 0, len(byClient))
	for _, c := range byClient {
		for _, months := range LapseMonths {
			if c.Lapsed(months, now, tx.Location()) {
				c.LapsedMonths = months
			}
		}
		out = append(out, *c)
	}
	slices.SortFunc(out, func(a, b Client) int { return cmp.Compare(a.ClientID, b.ClientID) })
	return out, nil
}

// addOwed adds to each client what their invoices charge that no receipt
// pays: the items listed as owed.
func addOwed(tx *txn.Tx, invoices []*documents.Document, charged map[documents.Source]int64, of func(string) *Client) error {
	clientOf := map[string]string{}
	for _, d := range invoices {
		clientOf[d.ID] = d.ClientID
	}
	owed, err := documents.Links.Open(tx)
	for _, l := range owed {
		if id, ok := clientOf[l.DocumentID]; ok {
			of(id).OwedCents += charged[l.Source]
		}
	}
	return err
}

// lineAmounts is what the live documents say of each item.
func lineAmounts(docs []*documents.Document) map[documents.Source]int64 {
	out := map[documents.Source]int64{}
	for _, d := range docs {
		if c := d.Counting(); c != nil {
			for _, line := range c.Lines {
				if line.Source != nil {
					out[*line.Source] += line.AmountCents
				}
			}
		}
	}
	return out
}
