package contacts

import (
	"context"
	"log/slog"
	"time"

	"bizzy-lambda/internal/features/clients"
	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/platform/txn"
)

// Each action here has two halves: the Google call, made by the route
// before the change runs (it can't be undone, or rerun), and Refresh,
// which copies what Google said onto the clients in one change.

// Link reads the contact a client is to be linked to, and adds it to the
// "Clients" label: what clients' routes call to link one (clients.Linker).
func Link(dir Directory, now func() time.Time) clients.Linker {
	return func(ctx context.Context, resourceName string) (clients.Contact, error) {
		p, err := dir.Get(ctx, resourceName)
		if err != nil {
			return clients.Contact{}, err
		}
		// The label is a convenience on the user's phone; a failure must
		// not stop the client being saved.
		if err := dir.Label(ctx, resourceName); err != nil {
			slog.WarnContext(ctx, "label contact", "resourceName", resourceName, "error", err)
		}
		return p.Link(now()), nil
	}
}

// Refresh copies what Google says of the contacts just changed (people)
// onto the clients linked to them.
func Refresh(tx *txn.Tx, people []Person) error {
	byName := byResourceName(people)
	everyone, err := clients.Clients.All(tx)
	if err != nil {
		return err
	}
	for _, c := range everyone {
		if next, changed := refreshed(c, byName, false, tx.Now()); changed {
			c.Contact = &next
		}
	}
	return nil
}

// RefreshAll copies what Google says of each linked client's contact onto
// the client, people being every contact: one that Google no longer has
// is marked missing, its copy kept so the user can recreate it. Clients
// are changed a batch to a commit, as every one of them may change at
// once (another account connected), more than one commit takes.
func RefreshAll(ctx context.Context, run *txn.Runner, people []Person) error {
	byName := byResourceName(people)
	everyone, err := txn.Read(ctx, run, clients.Clients.All)
	if err != nil {
		return err
	}
	var ids []string
	for _, c := range everyone {
		if _, changed := refreshed(c, byName, true, run.Now()); changed {
			ids = append(ids, c.ID)
		}
	}
	_, err = txn.RunBatched(ctx, run, ids, func(tx *txn.Tx, id string) (bool, error) {
		c, ok, err := clients.Clients.Find(tx, id)
		if err != nil || !ok {
			return false, err
		}
		next, changed := refreshed(c, byName, true, tx.Now())
		if changed {
			c.Contact = &next
		}
		return changed, nil
	})
	return err
}

func byResourceName(people []Person) map[string]Person {
	byName := map[string]Person{}
	for _, p := range people {
		byName[p.ResourceName] = p
	}
	return byName
}

// refreshed is the copy of a linked client's contact as Google has it
// (byName), and whether it says anything new. One that isn't there is
// missing if byName is every contact (all), else left as it is.
func refreshed(c *clients.Client, byName map[string]Person, all bool, now time.Time) (clients.Contact, bool) {
	if c.Contact == nil {
		return clients.Contact{}, false
	}
	next := *c.Contact
	if p, ok := byName[c.Contact.ResourceName]; ok {
		next = p.Link(now)
	} else if all {
		next.Missing = true
	}
	return next, !next.SameDetails(*c.Contact)
}

// checkDetails is the refusal for details Google wouldn't take as a
// contact.
func checkDetails(d Details, creating bool) error {
	if creating && d.GivenName == "" && d.FamilyName == "" {
		return apperr.Invalid("A contact needs a name.")
	}
	return nil
}
