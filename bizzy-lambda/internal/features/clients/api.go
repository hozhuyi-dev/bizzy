package clients

import (
	"context"
	"time"

	"bizzy-lambda/internal/platform/router"
	"bizzy-lambda/internal/platform/txn"
)

// View is a client as the app shows it.
type View struct {
	ID              string     `json:"id"`
	Name            string     `json:"name"`
	Aliases         []string   `json:"aliases"`
	FeeRates        []FeeRate  `json:"feeRates"`
	HomeVisits      bool       `json:"homeVisits"`
	Contact         *Contact   `json:"contact,omitempty"`
	LastContactedAt *time.Time `json:"lastContactedAt,omitempty"`
	// FeeTodayCents is the hourly fee a session without one would be
	// charged today; nil when no fee is set.
	FeeTodayCents *int64 `json:"feeTodayCents,omitempty"`
}

func viewOf(tx *txn.Tx, c *Client) View {
	v := View{
		ID: c.ID, Name: c.Name, Aliases: c.Aliases, FeeRates: c.FeeRates, HomeVisits: c.HomeVisits,
		Contact: c.Contact, LastContactedAt: c.LastContactedAt,
		FeeTodayCents: c.FeeOn(tx.Now().In(tx.Location()).Format(time.DateOnly)),
	}
	if v.Aliases == nil {
		v.Aliases = []string{}
	}
	if v.FeeRates == nil {
		v.FeeRates = []FeeRate{}
	}
	return v
}

// Linker reads the Google contact a client is linked to (see contacts),
// from outside the transaction: it is Google's.
type Linker func(ctx context.Context, resourceName string) (Contact, error)

type idRequest struct {
	ID string `json:"id"`
}

type contactRequest struct {
	// ResourceName is the contact to link; "" unlinks it.
	ResourceName string `json:"resourceName"`
}

type saveRequest struct {
	ID string `json:"id"`
	Fields
	// Contact is the contact to link; nil leaves it as it is.
	Contact *contactRequest `json:"contact"`
}

type contactedRequest struct {
	ID string `json:"id"`
	// Contacted false clears the mark, to undo a mis-tap.
	Contacted bool `json:"contacted"`
}

// Routes registers the clients' actions. owners are the kinds of items a
// client can have (see Delete).
func Routes(r *router.Router, run *txn.Runner, link Linker, owners ...Owner) {
	// fields reads the contact to link, if any, before the change runs.
	fields := func(ctx context.Context, in saveRequest) (Fields, error) {
		f := in.Fields
		switch {
		case in.Contact == nil:
		case in.Contact.ResourceName == "":
			f.Unlink = true
		default:
			contact, err := link(ctx, in.Contact.ResourceName)
			if err != nil {
				return f, err
			}
			f.Contact = &contact
		}
		return f, nil
	}

	r.Query("clients.list", router.Typed(func(ctx context.Context, _ struct{}) (any, error) {
		return txn.Read(ctx, run, func(tx *txn.Tx) (any, error) {
			all, err := Clients.All(tx)
			out := []View{}
			for _, c := range all {
				out = append(out, viewOf(tx, c))
			}
			return out, err
		})
	}))
	r.Query("clients.get", router.Typed(func(ctx context.Context, in idRequest) (any, error) {
		return txn.Read(ctx, run, func(tx *txn.Tx) (any, error) {
			c, err := Clients.Get(tx, in.ID)
			if err != nil {
				return nil, err
			}
			return viewOf(tx, c), nil
		})
	}))
	r.Mutation("clients.create", router.Typed(func(ctx context.Context, in saveRequest) (any, error) {
		f, err := fields(ctx, in)
		if err != nil {
			return nil, err
		}
		return txn.Run(ctx, run, func(tx *txn.Tx) (any, error) {
			c, err := Create(tx, f)
			if err != nil {
				return nil, err
			}
			return viewOf(tx, c), nil
		})
	}))
	r.Mutation("clients.update", router.Typed(func(ctx context.Context, in saveRequest) (any, error) {
		f, err := fields(ctx, in)
		if err != nil {
			return nil, err
		}
		return txn.Run(ctx, run, func(tx *txn.Tx) (any, error) {
			if f.Contact != nil {
				// The same contact keeps its copy as the sync last made it.
				if was, err := Clients.Get(tx, in.ID); err == nil && was.Contact != nil && was.Contact.ResourceName == f.Contact.ResourceName {
					f.Contact = was.Contact
				}
			}
			c, err := Update(tx, in.ID, f)
			if err != nil {
				return nil, err
			}
			return viewOf(tx, c), nil
		})
	}))
	r.Mutation("clients.delete", router.Typed(func(ctx context.Context, in idRequest) (any, error) {
		return txn.Run(ctx, run, func(tx *txn.Tx) (any, error) { return nil, Delete(tx, in.ID, owners...) })
	}))
	r.Mutation("clients.markContacted", router.Typed(func(ctx context.Context, in contactedRequest) (any, error) {
		return txn.Run(ctx, run, func(tx *txn.Tx) (any, error) {
			c, err := MarkContacted(tx, in.ID, in.Contacted)
			if err != nil {
				return nil, err
			}
			return viewOf(tx, c), nil
		})
	}))
}
