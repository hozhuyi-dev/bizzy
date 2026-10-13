package googleconnect

import (
	"context"
	"net/http"
	"testing"
	"time"

	"bizzy-lambda/internal/features/calendar"
	"bizzy-lambda/internal/platform/googleauth"
)

type memoryStore struct{ conn *Connection }

func (m *memoryStore) Get(context.Context) (*Connection, error) { return m.conn, nil }
func (m *memoryStore) Put(_ context.Context, c Connection) error {
	m.conn = &c
	return nil
}
func (m *memoryStore) Delete(context.Context) error {
	m.conn = nil
	return nil
}

type fakeAuth struct {
	email  string
	stored string
}

func (f *fakeAuth) Exchange(context.Context, string, string) (googleauth.Grant, error) {
	return googleauth.Grant{RefreshToken: "refresh", Email: f.email}, nil
}
func (f *fakeAuth) Store(_ context.Context, token string) error {
	f.stored = token
	return nil
}
func (f *fakeAuth) Revoke(context.Context) error                 { return nil }
func (f *fakeAuth) Check(context.Context) error                  { return nil }
func (f *fakeAuth) Client(context.Context) (*http.Client, error) { return http.DefaultClient, nil }

func calendars(context.Context, *http.Client) ([]calendar.Calendar, error) {
	return []calendar.Calendar{
		{ID: "her@gmail.com", Name: "Her calendar", Primary: true},
		{ID: "work-id", Name: "Clinic"},
	}, nil
}

func newHandler(repo *memoryStore, auth *fakeAuth) handler {
	return handler{repo: repo, auth: auth, calendars: calendars, now: func() time.Time { return time.Unix(0, 0) }}
}

func TestConnect(t *testing.T) {
	ctx := context.Background()

	t.Run("stores the grant and reads the primary calendar", func(t *testing.T) {
		repo, auth := &memoryStore{}, &fakeAuth{email: "her@gmail.com"}
		if _, err := newHandler(repo, auth).connect(ctx, connectInput{Code: "c", RedirectURI: "http://localhost:4200/google-callback"}); err != nil {
			t.Fatal(err)
		}
		if auth.stored != "refresh" {
			t.Error("refresh token not stored")
		}
		if repo.conn == nil || repo.conn.CalendarID != "her@gmail.com" || repo.conn.Email != "her@gmail.com" {
			t.Errorf("connection = %+v", repo.conn)
		}
	})

	t.Run("reconnecting the same account keeps the chosen calendar", func(t *testing.T) {
		repo := &memoryStore{conn: &Connection{Email: "Her@gmail.com", CalendarID: "work-id", CalendarName: "Clinic"}}
		if _, err := newHandler(repo, &fakeAuth{email: "her@gmail.com"}).connect(ctx, connectInput{Code: "c", RedirectURI: "r"}); err != nil {
			t.Fatal(err)
		}
		if repo.conn.CalendarID != "work-id" {
			t.Errorf("CalendarID = %q, want the one she chose", repo.conn.CalendarID)
		}
	})

	t.Run("another account starts from its primary calendar", func(t *testing.T) {
		repo := &memoryStore{conn: &Connection{Email: "test@gmail.com", CalendarID: "work-id"}}
		if _, err := newHandler(repo, &fakeAuth{email: "her@gmail.com"}).connect(ctx, connectInput{Code: "c", RedirectURI: "r"}); err != nil {
			t.Fatal(err)
		}
		if repo.conn.CalendarID != "her@gmail.com" {
			t.Errorf("CalendarID = %q, want the primary", repo.conn.CalendarID)
		}
	})
}

func TestSetCalendar(t *testing.T) {
	ctx := context.Background()
	repo := &memoryStore{conn: &Connection{Email: "her@gmail.com", CalendarID: "her@gmail.com"}}
	h := newHandler(repo, &fakeAuth{})

	if _, err := h.setCalendar(ctx, setCalendarInput{ID: "work-id"}); err != nil {
		t.Fatal(err)
	}
	if repo.conn.CalendarID != "work-id" || repo.conn.CalendarName != "Clinic" {
		t.Errorf("connection = %+v", repo.conn)
	}
	if _, err := h.setCalendar(ctx, setCalendarInput{ID: "someone-else"}); err == nil {
		t.Error("a calendar outside the account must be refused")
	}
}
