package googleconnect

import (
	"context"
	"errors"
	"log/slog"
	"slices"
	"strings"
	"time"

	"bizzy-lambda/internal/calendar"
	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/platform/router"
	"bizzy-lambda/internal/platform/txn"
)

// View is the connection as the app shows it and, if Google no longer
// accepts it, why.
type View struct {
	Email        string    `json:"email"`
	CalendarID   string    `json:"calendarId"`
	CalendarName string    `json:"calendarName"`
	ConnectedAt  time.Time `json:"connectedAt"`
	Problem      string    `json:"problem,omitempty"`
}

func viewOf(c *Connection) View {
	return View{Email: c.Email, CalendarID: c.CalendarID, CalendarName: c.CalendarName, ConnectedAt: c.ConnectedAt}
}

type connectRequest struct {
	Code string `json:"code"`
	// RedirectURI is where the browser told Google to send the user back;
	// the exchange must repeat it.
	RedirectURI string `json:"redirectUri"`
}

type setCalendarRequest struct {
	ID string `json:"id"`
}

// Routes registers the connection's actions.
func Routes(r *router.Router, run *txn.Runner, auth Auth) {
	calendars := func(ctx context.Context) ([]calendar.List, error) {
		client, err := auth.Client(ctx)
		if err != nil {
			return nil, err
		}
		return calendar.Calendars(ctx, client)
	}

	// google.status is null before the user connects.
	r.Query("google.status", router.Typed(func(ctx context.Context, _ struct{}) (any, error) {
		conn, err := txn.Read(ctx, run, func(tx *txn.Tx) (*Connection, error) {
			c, _, err := Connections.Find(tx, connectionID)
			return c, err
		})
		if err != nil || conn == nil {
			return nil, err
		}
		status := viewOf(conn)
		if err := auth.Check(ctx); err != nil {
			var shown *apperr.Error
			if errors.As(err, &shown) {
				status.Problem = shown.Message
			} else {
				slog.WarnContext(ctx, "google check failed", "error", err)
				status.Problem = "Couldn't reach Google just now."
			}
		}
		return status, nil
	}))

	r.Mutation("google.connect", router.Typed(func(ctx context.Context, in connectRequest) (any, error) {
		if in.Code == "" || in.RedirectURI == "" {
			return nil, apperr.Invalid("code and redirectUri are required")
		}
		grant, err := auth.Exchange(ctx, in.Code, in.RedirectURI)
		if err != nil {
			return nil, err
		}
		if err := auth.Store(ctx, grant.RefreshToken); err != nil {
			return nil, err
		}
		cals, err := calendars(ctx)
		if err != nil {
			return nil, err
		}
		return txn.Run(ctx, run, func(tx *txn.Tx) (any, error) {
			conn := &Connection{Email: grant.Email, ConnectedAt: tx.Now().UTC(), CalendarID: "primary", CalendarName: grant.Email}
			if i := slices.IndexFunc(cals, func(c calendar.List) bool { return c.Primary }); i >= 0 {
				conn.CalendarID, conn.CalendarName = cals[i].ID, cals[i].Name
			}
			was, ok, err := Connections.Find(tx, connectionID)
			switch {
			case err != nil:
				return nil, err
			case !ok:
				return viewOf(conn), Connections.Add(tx, conn)
			case strings.EqualFold(was.Email, grant.Email):
				// Reconnecting the same account keeps the calendar chosen.
				conn.CalendarID, conn.CalendarName = was.CalendarID, was.CalendarName
			}
			*was = *conn
			return viewOf(conn), nil
		})
	}))

	r.Mutation("google.disconnect", router.Typed(func(ctx context.Context, _ struct{}) (any, error) {
		if err := auth.Revoke(ctx); err != nil {
			return nil, err
		}
		return txn.Run(ctx, run, func(tx *txn.Tx) (any, error) { return nil, Connections.Delete(tx, connectionID) })
	}))

	r.Query("google.calendars", router.Typed(func(ctx context.Context, _ struct{}) (any, error) {
		return calendars(ctx)
	}))

	r.Mutation("google.setCalendar", router.Typed(func(ctx context.Context, in setCalendarRequest) (any, error) {
		cals, err := calendars(ctx)
		if err != nil {
			return nil, err
		}
		i := slices.IndexFunc(cals, func(c calendar.List) bool { return c.ID == in.ID })
		if i < 0 {
			return nil, apperr.NotFound("That calendar isn't in the connected account.")
		}
		return txn.Run(ctx, run, func(tx *txn.Tx) (any, error) {
			conn, err := Connections.Get(tx, connectionID)
			if err != nil {
				return nil, err
			}
			conn.CalendarID, conn.CalendarName = cals[i].ID, cals[i].Name
			return viewOf(conn), nil
		})
	}))
}
