// Package activity sums each client's sessions and money by month, and
// finds their last session and next booking: what the clients list and
// the business metrics read. It is read when asked for, from the sessions
// and the documents, so it is never out of date.
package activity

import (
	"cmp"
	"slices"
	"time"

	"bizzy-lambda/internal/features/documents"
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
// time zone).
type Client struct {
	ClientID      string           `json:"clientId"`
	Months        map[string]Month `json:"months"`
	LastSessionAt *time.Time       `json:"lastSessionAt,omitempty"`
	NextBookedAt  *time.Time       `json:"nextBookedAt,omitempty"`
}

// All is every client's activity as of now.
func All(tx *txn.Tx) ([]Client, error) {
	charged, err := lineAmounts(tx, documents.TypeInvoice)
	if err != nil {
		return nil, err
	}
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

	receipts, err := documents.Documents.Tagged(tx, string(documents.TypeReceipt))
	if err != nil {
		return nil, err
	}
	for _, d := range receipts {
		c := d.Counting()
		if c == nil || c.Payment == nil {
			continue
		}
		day, _ := time.Parse(time.DateOnly, c.Payment.PaidOn)
		total := c.Total()
		add(d.ClientID, day.Format("2006-01"), func(m *Month) { m.ReceivedCents += total })
	}

	all, err := sessions.Sessions.All(tx)
	if err != nil {
		return nil, err
	}
	slices.SortFunc(all, func(a, b *sessions.Session) int { return cmp.Or(a.Start.Compare(b.Start), cmp.Compare(a.ID, b.ID)) })
	credit := map[string]int{} // minutes of each package's credits used so far, in session order
	now := tx.Now()
	for _, s := range all {
		c := of(s.ClientID)
		if s.Start.After(now) {
			if c.NextBookedAt == nil || s.Start.Before(*c.NextBookedAt) {
				at := s.Start
				c.NextBookedAt = &at
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
		if c.LastSessionAt == nil || s.Start.After(*c.LastSessionAt) {
			at := s.Start
			c.LastSessionAt = &at
		}
	}

	out := make([]Client, 0, len(byClient))
	for _, c := range byClient {
		out = append(out, *c)
	}
	slices.SortFunc(out, func(a, b Client) int { return cmp.Compare(a.ClientID, b.ClientID) })
	return out, nil
}

// lineAmounts is what the live documents of a type say of each item.
func lineAmounts(tx *txn.Tx, t documents.Type) (map[documents.Source]int64, error) {
	docs, err := documents.Documents.Tagged(tx, string(t))
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
	return out, err
}
