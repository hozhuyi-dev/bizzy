package book

import (
	"context"
	"errors"
	"slices"
	"time"

	"bizzy-lambda/internal/features/clients"
	"bizzy-lambda/internal/features/conflicts"
	"bizzy-lambda/internal/features/documents"
	"bizzy-lambda/internal/features/followups"
	"bizzy-lambda/internal/features/packages"
	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/features/settings"
	"bizzy-lambda/internal/platform/dynamo"
)

// Repository is the book over DynamoDB: it reads through each feature's
// repository, and commits a change as one transaction.
type Repository struct {
	Store     *dynamo.Store
	Clients   clients.Repository
	Sessions  sessions.Repository
	Packages  packages.Repository
	Documents documents.Repository
	FollowUps followups.Repository
	Settings  settings.Repository
}

func (r Repository) Load(ctx context.Context, clientIDs []string, numbering []string) (Loaded, error) {
	var l Loaded
	var err error
	if l.Settings, err = r.Settings.Get(ctx); err != nil {
		return l, err
	}
	if l.Clients, err = r.Clients.List(ctx); err != nil {
		return l, err
	}
	l.ClientIDs = clientIDs
	for _, id := range clientIDs {
		ss, err := r.Sessions.ListByClient(ctx, id)
		if err != nil {
			return l, err
		}
		ps, err := r.Packages.ListByClient(ctx, id)
		if err != nil {
			return l, err
		}
		ds, err := r.Documents.ListByClient(ctx, id)
		if err != nil {
			return l, err
		}
		fs, err := r.FollowUps.ListByClient(ctx, id)
		if err != nil {
			return l, err
		}
		l.Sessions, l.Packages, l.Docs = append(l.Sessions, ss...), append(l.Packages, ps...), append(l.Docs, ds...)
		l.FollowUps = append(l.FollowUps, fs...)
	}
	l.Counters = map[string]int64{}
	for _, key := range numbering {
		if l.Counters[key], err = r.Documents.Counter(ctx, key); err != nil {
			return l, err
		}
	}
	return l, nil
}

func (r Repository) Owner(ctx context.Context, kind, id string) (string, bool, error) {
	switch kind {
	case "session":
		s, found, err := r.Sessions.Get(ctx, id)
		return s.ClientID, found, err
	case "package":
		p, found, err := r.Packages.Get(ctx, id)
		return p.ClientID, found, err
	case "followUp":
		f, found, err := r.FollowUps.Get(ctx, id)
		return f.ClientID, found, err
	default:
		d, found, err := r.Documents.Get(ctx, id)
		return d.ClientID, found, err
	}
}

func (r Repository) Booked(ctx context.Context, from, to time.Time) ([]sessions.Session, error) {
	return r.Sessions.ListByTime(ctx, from, to.Add(-time.Nanosecond))
}

func (r Repository) Counter(ctx context.Context, key string) (int64, error) {
	return r.Documents.Counter(ctx, key)
}

// maxTransaction is how many writes DynamoDB takes in one transaction.
const maxTransaction = 100

func (r Repository) Commit(ctx context.Context, c Change) error {
	items, err := Items(c)
	if err != nil {
		return err
	}
	if len(items) > maxTransaction && !c.Chunked {
		return errors.New("book: a change too big for one transaction")
	}
	for start := 0; start < len(items); start += maxTransaction {
		err := r.Store.Transact(ctx, items[start:min(start+maxTransaction, len(items))])
		if errors.Is(err, dynamo.ErrTransactionConflict) {
			return dynamo.ErrConflict
		}
		if err != nil {
			return err
		}
	}
	return nil
}

func unique(ids []string) []string {
	out := slices.Clone(ids)
	slices.Sort(out)
	return slices.Compact(out)
}

// Items are the writes of a change, each conditional on what was read.
func Items(c Change) ([]dynamo.TransactItem, error) {
	var items []dynamo.TransactItem
	for _, s := range c.Sessions {
		_, item := sessions.PutItem(s)
		items = append(items, item)
	}
	for _, s := range c.SessionsGone {
		items = append(items, sessions.DeleteItems(s)...)
	}
	for _, p := range c.Packages {
		_, item := packages.PutItem(p)
		items = append(items, item)
	}
	for _, p := range c.PackagesGone {
		items = append(items, packages.DeleteItem(p))
	}
	for _, d := range c.Docs {
		_, item := documents.PutItem(d)
		items = append(items, item)
	}
	for _, d := range c.DocsGone {
		items = append(items, documents.DeleteItem(d))
	}
	for _, f := range c.FollowUps {
		items = append(items, followups.PutItem(f))
	}
	for _, f := range c.FollowUpsGone {
		items = append(items, followups.DeleteItem(f))
	}
	for _, rev := range c.Revisions {
		items = append(items, documents.RevisionItem(rev))
	}
	for _, bump := range c.Counters {
		items = append(items, documents.CounterItem(bump))
	}
	for _, s := range c.Shares {
		items = append(items, documents.ShareItems(s.DocumentID, s.Change)...)
	}
	for _, e := range c.Externals {
		items = append(items, conflicts.ExternalPutItem(e))
	}
	for _, id := range unique(c.ExternalsGone) {
		items = append(items, conflicts.ExternalDeleteItem(conflicts.SurfaceCalendar, id))
	}
	for _, key := range unique(c.ConflictsGone) {
		items = append(items, conflicts.DeleteItem(key))
	}
	for _, client := range c.Clients {
		patch, err := clients.ActivityPatch(client)
		if err != nil {
			return nil, err
		}
		items = append(items, dynamo.TransactItem{Patch: &patch})
	}
	return items, nil
}
