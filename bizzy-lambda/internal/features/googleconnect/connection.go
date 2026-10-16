// Package googleconnect is the user's Google connection, made once in
// Settings: which account, and which of its calendars bizzy reads. The
// grant itself (the refresh token) is kept by googleauth.
package googleconnect

import (
	"context"
	"net/http"
	"time"

	"bizzy-lambda/internal/calendar"
	"bizzy-lambda/internal/platform/googleauth"
	"bizzy-lambda/internal/platform/txn"
)

// Connection is the connected account and the calendar the user chose.
type Connection struct {
	Email        string    `json:"email"`
	CalendarID   string    `json:"calendarId"`
	CalendarName string    `json:"calendarName"`
	ConnectedAt  time.Time `json:"connectedAt"`
}

const connectionID = "CONNECTION"

var Connections = txn.Kind[Connection]{
	Name: "GOOGLE", Gone: "Google isn't connected yet. Connect it in Settings.",
	Doc:  txn.Doc{What: "The connected Google account and calendar: one item, CONNECTION."},
	Meta: func(c *Connection) txn.Meta { return txn.Meta{ID: connectionID} },
}

// Auth is the part of googleauth.Auth this feature uses.
type Auth interface {
	Exchange(ctx context.Context, code, redirectURI string) (googleauth.Grant, error)
	Store(ctx context.Context, refreshToken string) error
	Revoke(ctx context.Context) error
	Check(ctx context.Context) error
	Client(ctx context.Context) (*http.Client, error)
}

// Calendar opens the calendar the user chose, acting as the user.
func Calendar(run *txn.Runner, auth Auth) func(ctx context.Context) (calendar.Calendar, error) {
	return func(ctx context.Context) (calendar.Calendar, error) {
		conn, err := txn.Read(ctx, run, func(tx *txn.Tx) (*Connection, error) { return Connections.Get(tx, connectionID) })
		if err != nil {
			return nil, err
		}
		client, err := auth.Client(ctx)
		if err != nil {
			return nil, err
		}
		return calendar.NewGoogle(ctx, client, conn.CalendarID)
	}
}
