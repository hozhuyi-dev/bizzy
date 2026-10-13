package googleconnect

import (
	"context"
	"net/http"

	"bizzy-lambda/internal/features/calendar"
	"bizzy-lambda/internal/platform/dynamo"
	"bizzy-lambda/internal/platform/googleauth"
	"bizzy-lambda/internal/schema"
)

// Partition is kept by Reset.
const Partition = schema.Google

type record struct {
	dynamo.Keys
	Connection
}

type Repository struct {
	store *dynamo.Store
}

func NewRepository(store *dynamo.Store) Repository {
	return Repository{store: store}
}

// Get returns nil until she connects.
func (r Repository) Get(ctx context.Context) (*Connection, error) {
	var rec record
	keys := schema.GoogleKeys()
	found, err := r.store.Get(ctx, keys.PK, keys.SK, &rec)
	if err != nil || !found {
		return nil, err
	}
	return &rec.Connection, nil
}

func (r Repository) Put(ctx context.Context, c Connection) error {
	return r.store.Put(ctx, record{Keys: schema.GoogleKeys(), Connection: c})
}

func (r Repository) Delete(ctx context.Context) error {
	keys := schema.GoogleKeys()
	_, err := r.store.Delete(ctx, keys.PK, keys.SK, nil)
	return err
}

// Calendar opens the calendar she chose, acting as her. It is read on every
// call, since she can change it in Settings any time.
func (r Repository) Calendar(ctx context.Context, client func(ctx context.Context) (*http.Client, error)) (*calendar.GoogleCalendar, error) {
	conn, err := r.Get(ctx)
	if err != nil {
		return nil, err
	}
	if conn == nil {
		return nil, googleauth.ErrNotConnected
	}
	httpClient, err := client(ctx)
	if err != nil {
		return nil, err
	}
	return calendar.NewGoogleCalendar(ctx, httpClient, conn.CalendarID)
}
