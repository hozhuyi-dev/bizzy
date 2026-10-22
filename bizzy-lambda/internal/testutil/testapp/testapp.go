// Package testapp is the whole app (internal/app) on the memory table and
// fakes of Google Calendar, Google Contacts and S3, called through the
// router with JSON as the web app calls it. Feature tests and the
// simulation build on it.
package testapp

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"bizzy-lambda/internal/app"
	"bizzy-lambda/internal/calendar"
	"bizzy-lambda/internal/features/contacts"
	"bizzy-lambda/internal/migrations"
	"bizzy-lambda/internal/platform/migrate"
	"bizzy-lambda/internal/platform/router"
	"bizzy-lambda/internal/platform/table"
	"bizzy-lambda/internal/testutil/fakecal"
	"bizzy-lambda/internal/testutil/fakecontacts"
	"bizzy-lambda/internal/testutil/memblob"
)

// The practice is in Kuala Lumpur; the clock starts on a Tuesday morning.
var (
	KL    = time.FixedZone("MYT", 8*60*60)
	Epoch = time.Date(2026, 10, 13, 1, 0, 0, 0, time.UTC)
)

type App struct {
	*app.App
	Table    *table.Memory
	Calendar *fakecal.Calendar
	Contacts *fakecontacts.Directory
	Blobs    *memblob.Store
	// Now is the clock; move it on to pass time.
	Now time.Time
}

func New() *App {
	a := &App{Table: table.NewMemory(), Contacts: &fakecontacts.Directory{}, Blobs: memblob.New(), Now: Epoch}
	a.Calendar = &fakecal.Calendar{Now: func() time.Time { return a.Now }}
	ids := 0
	a.App = app.New(app.Deps{
		Table:      a.Table,
		Blobs:      a.Blobs,
		Contacts:   a.Contacts,
		Resettable: true,
		Calendar:   func(context.Context) (calendar.Calendar, error) { return a.Calendar, nil },
		Location:   KL,
		Now:        func() time.Time { return a.Now },
		NewID:      func() string { ids++; return fmt.Sprintf("id%03d", ids) },
	})
	// As a deploy does: the code serves only a table at its version.
	if _, err := migrate.Run(context.Background(), migrate.Options{Runner: a.Runner, Kinds: app.Kinds(), Migrations: migrations.All}); err != nil {
		panic(err)
	}
	return a
}

// Call sends an action as the web app does. refused is the error the app
// would show; err is a failure the app shows as "Something went wrong",
// which is always a bug.
func (a *App) Call(action string, payload any) (data json.RawMessage, refused *router.ErrorBody, err error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, nil, err
	}
	res, _ := a.Router.Handle(context.Background(), router.Request{Action: action, Payload: body})
	if res.Error != nil {
		if res.Error.Code == "internal" {
			return nil, nil, fmt.Errorf("%s %s failed; see the log", action, body)
		}
		return nil, res.Error, nil
	}
	data, err = json.Marshal(res.Data)
	return data, nil, err
}

// Must calls an action that must succeed, and decodes its result into out
// (when not nil).
func (a *App) Must(action string, payload any, out any) error {
	data, refused, err := a.Call(action, payload)
	switch {
	case err != nil:
		return err
	case refused != nil:
		return fmt.Errorf("%s refused: %s", action, refused.Message)
	case out != nil:
		return json.Unmarshal(data, out)
	}
	return nil
}

// Contact adds a Google contact, as the user would on a phone, and returns
// its resource name.
func (a *App) Contact(name string) string {
	given, family, _ := strings.Cut(name, " ")
	p, _ := a.Contacts.Create(context.Background(), contacts.Details{GivenName: given, FamilyName: family, Phone: "012 345 6789"})
	return p.ResourceName
}

// Client adds a client linked to a new contact, with fields set as the
// app's form sends them, and returns its id.
func (a *App) Client(name string, fields map[string]any) (string, error) {
	in := map[string]any{"name": name, "contact": map[string]any{"resourceName": a.Contact(name)}}
	for k, v := range fields {
		in[k] = v
	}
	var out struct {
		ID string `json:"id"`
	}
	err := a.Must("clients.create", in, &out)
	return out.ID, err
}
