// Package google is her Google connection, made once in Settings: which
// account, and which of its calendars the sync reads. The grant itself
// (the refresh token) is kept by googleauth.
package google

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"slices"
	"strings"
	"time"

	"bizzy-lambda/internal/features/calendar"
	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/platform/dynamo"
	"bizzy-lambda/internal/platform/googleauth"
	"bizzy-lambda/internal/router"
)

// Connection is the connected account.
type Connection struct {
	Email        string    `json:"email" dynamodbav:"email"`
	CalendarID   string    `json:"calendarId" dynamodbav:"calendarId"`
	CalendarName string    `json:"calendarName" dynamodbav:"calendarName"`
	ConnectedAt  time.Time `json:"connectedAt" dynamodbav:"connectedAt"`
}

const (
	Partition = "GOOGLE"
	sortKey   = "CONNECTION"
)

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
	found, err := r.store.Get(ctx, Partition, sortKey, &rec)
	if err != nil || !found {
		return nil, err
	}
	return &rec.Connection, nil
}

func (r Repository) Put(ctx context.Context, c Connection) error {
	return r.store.Put(ctx, record{Keys: dynamo.Keys{PK: Partition, SK: sortKey}, Connection: c})
}

func (r Repository) Delete(ctx context.Context) error {
	_, err := r.store.Delete(ctx, Partition, sortKey, nil)
	return err
}

type store interface {
	Get(ctx context.Context) (*Connection, error)
	Put(ctx context.Context, c Connection) error
	Delete(ctx context.Context) error
}

// Auth is the part of googleauth.Auth the handlers use.
type Auth interface {
	Exchange(ctx context.Context, code, redirectURI string) (googleauth.Grant, error)
	Store(ctx context.Context, refreshToken string) error
	Revoke(ctx context.Context) error
	Check(ctx context.Context) error
	Client(ctx context.Context) (*http.Client, error)
}

type handler struct {
	repo      store
	auth      Auth
	calendars func(ctx context.Context, client *http.Client) ([]calendar.Calendar, error)
	now       func() time.Time
}

func Register(r *router.Router, repo store, auth Auth) {
	h := handler{repo: repo, auth: auth, calendars: calendar.Calendars, now: time.Now}
	r.Register("google.status", h.status)
	r.Register("google.connect", router.Typed(h.connect))
	r.Register("google.disconnect", h.disconnect)
	r.Register("google.calendars", h.listCalendars)
	r.Register("google.setCalendar", router.Typed(h.setCalendar))
}

// Status is the connection and, if Google no longer accepts it, why.
type Status struct {
	Connection
	Problem string `json:"problem,omitempty"`
}

// status returns null before she connects.
func (h handler) status(ctx context.Context, _ json.RawMessage) (any, error) {
	conn, err := h.repo.Get(ctx)
	if err != nil || conn == nil {
		return nil, err
	}

	status := Status{Connection: *conn}
	if err := h.auth.Check(ctx); err != nil {
		var appErr *apperr.Error
		if errors.As(err, &appErr) {
			status.Problem = appErr.Message
		} else {
			slog.WarnContext(ctx, "google check failed", "error", err)
			status.Problem = "Couldn't reach Google just now."
		}
	}
	return status, nil
}

type connectInput struct {
	Code string `json:"code"`
	// RedirectURI is where the browser told Google to send her back; the
	// exchange must repeat it.
	RedirectURI string `json:"redirectUri"`
}

func (h handler) connect(ctx context.Context, in connectInput) (any, error) {
	if in.Code == "" || in.RedirectURI == "" {
		return nil, apperr.Invalid("code and redirectUri are required")
	}

	grant, err := h.auth.Exchange(ctx, in.Code, in.RedirectURI)
	if err != nil {
		return nil, err
	}
	if err := h.auth.Store(ctx, grant.RefreshToken); err != nil {
		return nil, err
	}

	previous, err := h.repo.Get(ctx)
	if err != nil {
		return nil, err
	}

	conn := Connection{Email: grant.Email, ConnectedAt: h.now().UTC()}
	if previous != nil && strings.EqualFold(previous.Email, grant.Email) {
		// Reconnecting the same account keeps the calendar she chose.
		conn.CalendarID, conn.CalendarName = previous.CalendarID, previous.CalendarName
	} else {
		cals, err := h.listAll(ctx)
		if err != nil {
			return nil, err
		}
		conn.CalendarID, conn.CalendarName = "primary", grant.Email
		if i := slices.IndexFunc(cals, func(c calendar.Calendar) bool { return c.Primary }); i >= 0 {
			conn.CalendarID, conn.CalendarName = cals[i].ID, cals[i].Name
		}
	}

	if err := h.repo.Put(ctx, conn); err != nil {
		return nil, err
	}
	return Status{Connection: conn}, nil
}

func (h handler) disconnect(ctx context.Context, _ json.RawMessage) (any, error) {
	if err := h.auth.Revoke(ctx); err != nil {
		return nil, err
	}
	return nil, h.repo.Delete(ctx)
}

func (h handler) listCalendars(ctx context.Context, _ json.RawMessage) (any, error) {
	return h.listAll(ctx)
}

type setCalendarInput struct {
	ID string `json:"id"`
}

func (h handler) setCalendar(ctx context.Context, in setCalendarInput) (any, error) {
	conn, err := h.repo.Get(ctx)
	if err != nil {
		return nil, err
	}
	if conn == nil {
		return nil, googleauth.ErrNotConnected
	}

	cals, err := h.listAll(ctx)
	if err != nil {
		return nil, err
	}
	i := slices.IndexFunc(cals, func(c calendar.Calendar) bool { return c.ID == in.ID })
	if i < 0 {
		return nil, apperr.NotFound("that calendar isn't in the connected account")
	}

	conn.CalendarID, conn.CalendarName = cals[i].ID, cals[i].Name
	if err := h.repo.Put(ctx, *conn); err != nil {
		return nil, err
	}
	return Status{Connection: *conn}, nil
}

func (h handler) listAll(ctx context.Context) ([]calendar.Calendar, error) {
	client, err := h.auth.Client(ctx)
	if err != nil {
		return nil, err
	}
	return h.calendars(ctx, client)
}
