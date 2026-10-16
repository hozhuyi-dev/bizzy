package clients

import (
	"fmt"
	"slices"
	"strings"

	"bizzy-lambda/internal/calendar"
	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/platform/txn"
)

// Fields are what the app sets on a client; nil leaves a field as it is.
type Fields struct {
	Name       *string    `json:"name,omitempty"`
	Aliases    *[]string  `json:"aliases,omitempty"`
	FeeRates   *[]FeeRate `json:"feeRates,omitempty"`
	HomeVisits *bool      `json:"homeVisits,omitempty"`
	// Contact links the client to a Google contact, read from Google by
	// the route (see Routes); Unlink drops the link, to undo a wrong one.
	Contact *Contact `json:"-"`
	Unlink  bool     `json:"-"`
}

// Create adds a client, linked to a Google contact.
func Create(tx *txn.Tx, f Fields) (*Client, error) {
	switch {
	case f.Name == nil:
		return nil, apperr.Invalid("A client needs a name.")
	case f.Contact == nil:
		return nil, apperr.Invalid("Choose the client's Google contact, or create one.")
	}
	c := &Client{ID: tx.NewID()}
	if err := apply(tx, c, f); err != nil {
		return nil, err
	}
	return c, Clients.Add(tx, c)
}

// Update changes what f sets.
func Update(tx *txn.Tx, id string, f Fields) (*Client, error) {
	c, err := Clients.Get(tx, id)
	if err != nil {
		return nil, err
	}
	return c, apply(tx, c, f)
}

// Owner is a kind of item that belongs to a client, which deleting the
// client would leave without one. The app passes them in (sessions, …),
// since the features that own clients' items import this one, not the
// other way round.
type Owner struct {
	// What names them in a refusal: "sessions".
	What string
	Has  func(tx *txn.Tx, clientID string) (bool, error)
}

// Delete removes a client who has nothing left.
func Delete(tx *txn.Tx, id string, owners ...Owner) error {
	c, err := Clients.Get(tx, id)
	if err != nil {
		return err
	}
	for _, o := range owners {
		has, err := o.Has(tx, id)
		if err != nil {
			return err
		}
		if has {
			return apperr.Refused(fmt.Sprintf("%s still has %s. Delete those first.", c.Name, o.What))
		}
	}
	return Clients.Delete(tx, id)
}

// MarkContacted records that the user got back to the client, or clears
// it, to undo a mis-tap.
func MarkContacted(tx *txn.Tx, id string, contacted bool) (*Client, error) {
	c, err := Clients.Get(tx, id)
	if err != nil {
		return nil, err
	}
	c.LastContactedAt = nil
	if contacted {
		at := tx.Now().UTC()
		c.LastContactedAt = &at
	}
	return c, nil
}

// apply makes the changes f asks, each step checking its own rules.
func apply(tx *txn.Tx, c *Client, f Fields) error {
	if f.Name != nil {
		name := strings.Join(strings.Fields(*f.Name), " ")
		if name == "" {
			return apperr.Invalid("A client needs a name.")
		}
		if !calendar.Writable(name) {
			return apperr.Invalid("%q can't be written in a calendar title: give the client a name that doesn't end in a number, without a colon.", name)
		}
		c.Name = name
	}
	if f.Aliases != nil {
		c.Aliases = nil
		for _, a := range *f.Aliases {
			if a = strings.Join(strings.Fields(a), " "); a != "" && Normalize(a) != Normalize(c.Name) {
				c.Aliases = append(c.Aliases, a)
			}
		}
	}
	if f.FeeRates != nil {
		rates := slices.Clone(*f.FeeRates)
		slices.SortStableFunc(rates, func(a, b FeeRate) int { return strings.Compare(a.From, b.From) })
		if err := checkFeeRates(rates); err != nil {
			return err
		}
		c.FeeRates = rates
	}
	if f.HomeVisits != nil {
		c.HomeVisits = *f.HomeVisits
	}
	switch {
	case f.Contact != nil:
		c.Contact = f.Contact
	case f.Unlink:
		c.Contact = nil
	}
	return namesTaken(tx, c)
}
