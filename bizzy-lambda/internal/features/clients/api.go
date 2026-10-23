package clients

import (
	"context"
	"time"

	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/platform/router"
	"bizzy-lambda/internal/platform/txn"
)

// View is a client as the app shows it.
type View struct {
	ID      string   `json:"id"`
	Name    string   `json:"name"`
	Aliases []string `json:"aliases"`
	// FeeCents is the usual hourly fee a new session is charged; nil when
	// none is set.
	FeeCents   *int64     `json:"feeCents,omitempty"`
	HomeVisits bool       `json:"homeVisits"`
	IDNo       string     `json:"idNo,omitempty"`
	Contact    *Contact   `json:"contact,omitempty"`
	ArchivedAt *time.Time `json:"archivedAt,omitempty"`
	Can        Can        `json:"can"`
}

// Can is what each action on a client would say now.
type Can struct {
	Archive   apperr.Verdict `json:"archive"`
	Unarchive apperr.Verdict `json:"unarchive"`
	Delete    apperr.Verdict `json:"delete"`
}

// ViewOf is a client as of now; owners are the kinds of items a client
// can have (see Delete).
func ViewOf(tx *txn.Tx, c *Client, owners ...Owner) (View, error) {
	v := View{
		ID: c.ID, Name: c.Name, Aliases: c.Aliases, FeeCents: c.FeeCents, HomeVisits: c.HomeVisits, IDNo: c.IDNo,
		Contact: c.Contact, ArchivedAt: c.ArchivedAt,
	}
	if v.Aliases == nil {
		v.Aliases = []string{}
	}
	for _, x := range []struct {
		verdict *apperr.Verdict
		check   error
	}{
		{&v.Can.Archive, CanArchive(c)},
		{&v.Can.Unarchive, CanUnarchive(c)},
		{&v.Can.Delete, CanDelete(tx, c, owners...)},
	} {
		var err error
		if *x.verdict, err = apperr.VerdictOf(x.check); err != nil {
			return View{}, err
		}
	}
	return v, nil
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

	view := func(tx *txn.Tx, c *Client, err error) (any, error) {
		if err != nil {
			return nil, err
		}
		return ViewOf(tx, c, owners...)
	}

	// clients.list lists every client, archived ones too: the app shows
	// them apart, and still names them on what is theirs.
	r.Query("clients.list", router.Typed(func(ctx context.Context, _ struct{}) (any, error) {
		return txn.Read(ctx, run, func(tx *txn.Tx) ([]View, error) {
			all, err := Clients.All(tx)
			if err != nil {
				return nil, err
			}
			out := []View{}
			for _, c := range all {
				v, err := ViewOf(tx, c, owners...)
				if err != nil {
					return nil, err
				}
				out = append(out, v)
			}
			return out, nil
		})
	}))
	r.Query("clients.get", router.Typed(func(ctx context.Context, in idRequest) (any, error) {
		return txn.Read(ctx, run, func(tx *txn.Tx) (any, error) {
			c, err := Clients.Get(tx, in.ID)
			return view(tx, c, err)
		})
	}))
	r.Mutation("clients.create", router.Typed(func(ctx context.Context, in saveRequest) (any, error) {
		f, err := fields(ctx, in)
		if err != nil {
			return nil, err
		}
		return txn.Run(ctx, run, func(tx *txn.Tx) (any, error) {
			c, err := Create(tx, f)
			return view(tx, c, err)
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
			return view(tx, c, err)
		})
	}))
	r.Mutation("clients.archive", router.Typed(func(ctx context.Context, in idRequest) (any, error) {
		return txn.Run(ctx, run, func(tx *txn.Tx) (any, error) {
			c, err := Archive(tx, in.ID)
			return view(tx, c, err)
		})
	}))
	r.Mutation("clients.unarchive", router.Typed(func(ctx context.Context, in idRequest) (any, error) {
		return txn.Run(ctx, run, func(tx *txn.Tx) (any, error) {
			c, err := Unarchive(tx, in.ID)
			return view(tx, c, err)
		})
	}))
	r.Mutation("clients.delete", router.Typed(func(ctx context.Context, in idRequest) (any, error) {
		return txn.Run(ctx, run, func(tx *txn.Tx) (any, error) { return nil, Delete(tx, in.ID, owners...) })
	}))
}
