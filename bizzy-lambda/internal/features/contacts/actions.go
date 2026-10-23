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

// Refresh copies what Google says of each linked client's contact onto
// the client; one that Google no longer has is marked missing, its copy
// kept so the user can recreate it. people is every contact (all), or
// the ones just changed.
func Refresh(tx *txn.Tx, people []Person, all bool) error {
	byName := map[string]Person{}
	for _, p := range people {
		byName[p.ResourceName] = p
	}
	everyone, err := clients.Clients.All(tx)
	if err != nil {
		return err
	}
	for _, c := range everyone {
		if c.Contact == nil {
			continue
		}
		next := *c.Contact
		if p, ok := byName[c.Contact.ResourceName]; ok {
			next = p.Link(tx.Now())
		} else if all {
			next.Missing = true
		} else {
			continue
		}
		if !next.SameDetails(*c.Contact) {
			c.Contact = &next
		}
	}
	return nil
}

// checkDetails is the refusal for details Google wouldn't take as a
// contact.
func checkDetails(d Details, creating bool) error {
	if creating && d.GivenName == "" && d.FamilyName == "" {
		return apperr.Invalid("A contact needs a name.")
	}
	return nil
}
