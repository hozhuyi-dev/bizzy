// Package clients is the practice's clients: who they are, the names a
// calendar title can call them by, their usual hourly fee and place, and the
// Google contact their details live in.
package clients

import (
	"fmt"
	"regexp"
	"slices"
	"strings"
	"time"

	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/platform/txn"
)

type Client struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	// Aliases are other names the user's calendar titles call the client
	// by, e.g. "jane s".
	Aliases []string `json:"aliases,omitempty"`
	// FeeRates are the client's hourly fees over time, oldest first,
	// charging for what package credits leave of a session with no fee
	// typed (see FeeOn). A new fee from a date leaves the sessions before
	// it alone.
	FeeRates []FeeRate `json:"feeRates,omitempty"`
	// HomeVisits makes the client's sessions home visits unless a title
	// says (H).
	HomeVisits bool `json:"homeVisits,omitempty"`
	// IDNo is the client's IC (MyKad) or passport number, printed under
	// their name on documents. It is kept in bizzy, not in Google: a
	// billing identity, not a way to reach them (see IDNo).
	IDNo string `json:"idNo,omitempty"`
	// Contact is the linked Google contact, where the client's details
	// live, with a copy of them.
	Contact *Contact `json:"contact,omitempty"`
	// ArchivedAt is when the user put the client away: kept with all that
	// is theirs, out of the lists and pickers, and booked again only once
	// unarchived (see Active).
	ArchivedAt *time.Time `json:"archivedAt,omitempty"`
}

// Archived reports whether the client was put away.
func (c Client) Archived() bool { return c.ArchivedAt != nil }

var Clients = txn.Kind[Client]{
	Name: "CLIENT", Gone: "This client was deleted.",
	Doc:   txn.Doc{What: "A client: name, calendar names, usual hourly fees and place, IC or passport number, a copy of their Google contact, and whether archived."},
	Meta:  func(c *Client) txn.Meta { return txn.Meta{ID: c.ID} },
	Whole: true,
}

// FeeRate is one hourly fee and the day it starts.
type FeeRate struct {
	// From is the first local day (YYYY-MM-DD) it applies; empty for the
	// first rate, which also covers every session before the next one.
	From  string `json:"from,omitempty"`
	Cents int64  `json:"cents"`
}

// FeeOn is the hourly fee for a session on a local day (YYYY-MM-DD): the
// last rate starting on or before it. Nil when no fee is set.
func (c Client) FeeOn(day string) *int64 {
	var fee *int64
	for _, r := range c.FeeRates {
		if r.From > day {
			break
		}
		fee = &r.Cents
	}
	return fee
}

// Contact is the linked Google contact with a read-only copy of the
// details bizzy uses. Google is the truth: edits in the app go straight to
// Google (see contacts), and every sync refreshes the copy.
type Contact struct {
	// ResourceName is the contact's id in the People API ("people/c123").
	ResourceName string `json:"resourceName"`
	// ETag is the contact's version when copied.
	ETag        string `json:"etag,omitempty"`
	DisplayName string `json:"displayName,omitempty"`
	Email       string `json:"email,omitempty"`
	Phone       string `json:"phone,omitempty"`
	// Address is printed on receipts; Postcode is kept apart so clients
	// can be grouped by area.
	Address  string `json:"address,omitempty"`
	Postcode string `json:"postcode,omitempty"`
	// Missing is set when the sync no longer finds the contact in Google:
	// the copy is kept, so it can be recreated from it.
	Missing  bool      `json:"missing,omitempty"`
	SyncedAt time.Time `json:"syncedAt"`
}

// SameDetails reports whether two copies say the same, whenever taken.
func (c Contact) SameDetails(other Contact) bool {
	c.SyncedAt, other.SyncedAt = time.Time{}, time.Time{}
	return c == other
}

// Names are every name a calendar title can call the client by,
// normalized: their name first.
func (c Client) Names() []string {
	names := []string{Normalize(c.Name)}
	for _, a := range c.Aliases {
		if n := Normalize(a); n != "" && !slices.Contains(names, n) {
			names = append(names, n)
		}
	}
	return names
}

// Normalize is a name as titles are matched: case and spacing don't count.
func Normalize(name string) string {
	return strings.ToLower(strings.Join(strings.Fields(name), " "))
}

// Match is the client a calendar title names, or the refusal to show:
// for a name that nearly matches one, adding it as that client's calendar
// name is offered first.
func Match(tx *txn.Tx, name string) (*Client, error) {
	all, err := Clients.All(tx)
	if err != nil {
		return nil, err
	}
	m := MatchName(name, AliasesOf(all))
	if m.Kind == MatchExact {
		return Clients.Get(tx, m.ClientID)
	}
	message := fmt.Sprintf("No client is called %q.", name)
	var remedies []apperr.Remedy
	if m.Kind == MatchNearMiss {
		c, err := Clients.Get(tx, m.ClientID)
		if err != nil {
			return nil, err
		}
		message = fmt.Sprintf("No client is called %q. Did you mean %s?", name, c.Name)
		remedies = append(remedies, apperr.Remedy{
			Action: "clients.update", Target: c.ID,
			Request: map[string]any{"aliases": append(slices.Clone(c.Aliases), name)},
			Label:   fmt.Sprintf("Add %q as %s's calendar name", name, c.Name),
		})
	}
	remedies = append(remedies, apperr.Remedy{Action: "clients.create", Request: map[string]any{"name": name}, Label: fmt.Sprintf("Add %s as a client", name)})
	return nil, apperr.Refused(message, remedies...)
}

// namesTaken is the refusal when another client already answers to one of
// c's names, so a title naming it would be ambiguous.
func namesTaken(tx *txn.Tx, c *Client) error {
	all, err := Clients.All(tx)
	if err != nil {
		return err
	}
	for _, other := range all {
		if other.ID == c.ID {
			continue
		}
		for _, n := range c.Names() {
			if slices.Contains(other.Names(), n) {
				return apperr.Refused(fmt.Sprintf("%s is already called %q.", other.Name, n),
					apperr.Remedy{Action: "clients.update", Target: other.ID, Label: "Change " + other.Name + "'s names"})
			}
		}
	}
	return nil
}

// maxIDNo bounds an IC or passport number: a MyKad is 14 characters with
// its dashes, a passport 9 or so.
const maxIDNo = 20

// myKad is a MyKad number as typed, with or without dashes and spaces.
var myKad = regexp.MustCompile(`^(\d{6})[- ]?(\d{2})[- ]?(\d{4})$`)

// IDNo is an IC or passport number as kept and printed: a MyKad written
// 900101-14-5678, anything else (a passport) in capitals, as typed. ""
// clears it.
func IDNo(typed string) (string, error) {
	id := strings.ToUpper(strings.Join(strings.Fields(typed), " "))
	if m := myKad.FindStringSubmatch(id); m != nil {
		return m[1] + "-" + m[2] + "-" + m[3], nil
	}
	if len(id) > maxIDNo {
		return "", apperr.Invalid("%q is too long for an IC or passport number.", typed)
	}
	return id, nil
}

// checkFeeRates is the refusal for fee rates out of order: the first
// applies from the start, every later one from a day of its own.
func checkFeeRates(rates []FeeRate) error {
	for i, r := range rates {
		switch {
		case r.Cents < 0:
			return apperr.Invalid("A fee can't be negative.")
		case i == 0 && r.From != "":
			return apperr.Invalid("The first fee applies from the start, so it has no date.")
		case i == 0:
		case r.From == "":
			return apperr.Invalid("Only the first fee applies from the start; give the others a date.")
		case r.From <= rates[i-1].From:
			return apperr.Invalid("Each fee starts on a day of its own, after the one before.")
		default:
			if _, err := time.Parse(time.DateOnly, r.From); err != nil {
				return apperr.Invalid("%q is not a date.", r.From)
			}
		}
	}
	return nil
}
