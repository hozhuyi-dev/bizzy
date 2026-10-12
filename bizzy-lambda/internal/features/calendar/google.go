package calendar

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"

	gcal "google.golang.org/api/calendar/v3"
	"google.golang.org/api/googleapi"
	"google.golang.org/api/option"

	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/platform/googleauth"
)

var (
	ErrGone    = apperr.NotFound("That event is no longer in the calendar.")
	ErrChanged = apperr.Conflict("This session was changed in the calendar meanwhile. Check the latest and try again.")
)

// Event is the part of a Google Calendar event the sync cares about. With
// singleEvents=true each recurring instance arrives with its own ID.
type Event struct {
	ID    string
	Title string
	Start time.Time
	End   time.Time
	// ColorID is the event's own colour ("" for the calendar's default).
	ColorID   string
	AllDay    bool
	Cancelled bool
	// ETag is the version read; a write against an older one is refused.
	ETag string
}

// EventInput is what the app writes to an event. Anything else on the event
// (description, reminders, guests) is left as it is.
type EventInput struct {
	Title string
	Start time.Time
	End   time.Time
	// ColorID "" clears the event's own colour.
	ColorID string
}

// GoogleCalendar reads and writes one of her calendars, acting as her (see
// googleauth).
type GoogleCalendar struct {
	service    *gcal.Service
	calendarID string
}

func NewGoogleCalendar(ctx context.Context, client *http.Client, calendarID string) (*GoogleCalendar, error) {
	service, err := gcal.NewService(ctx, option.WithHTTPClient(client))
	if err != nil {
		return nil, err
	}
	return &GoogleCalendar{service: service, calendarID: calendarID}, nil
}

// Calendar is one of her calendars, to choose which one the sync reads.
type Calendar struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Primary bool   `json:"primary,omitempty"`
}

// Calendars lists the calendars her account can see.
func Calendars(ctx context.Context, client *http.Client) ([]Calendar, error) {
	service, err := gcal.NewService(ctx, option.WithHTTPClient(client))
	if err != nil {
		return nil, err
	}

	var all []Calendar
	err = service.CalendarList.List().Pages(ctx, func(page *gcal.CalendarList) error {
		for _, item := range page.Items {
			name := item.SummaryOverride
			if name == "" {
				name = item.Summary
			}
			all = append(all, Calendar{ID: item.Id, Name: name, Primary: item.Primary})
		}
		return nil
	})
	return all, googleauth.Wrap("list calendars", err)
}

// Events lists event instances starting in [from, to). Recurring events are
// expanded, and deleted instances are included so the sync can remove them.
func (g *GoogleCalendar) Events(ctx context.Context, from, to time.Time) ([]Event, error) {
	var events []Event

	call := g.service.Events.List(g.calendarID).
		SingleEvents(true).
		ShowDeleted(true).
		OrderBy("startTime").
		TimeMin(from.Format(time.RFC3339)).
		TimeMax(to.Format(time.RFC3339)).
		MaxResults(250)

	err := call.Pages(ctx, func(page *gcal.Events) error {
		for _, item := range page.Items {
			event, err := toEvent(item)
			if err != nil {
				return err
			}
			events = append(events, event)
		}
		return nil
	})

	return events, googleauth.Wrap("list events", err)
}

// Get reads one event. A deleted one comes back cancelled.
func (g *GoogleCalendar) Get(ctx context.Context, id string) (Event, error) {
	item, err := g.service.Events.Get(g.calendarID, id).Context(ctx).Do()
	if err != nil {
		return Event{}, apiErr("get event", err)
	}
	return toEvent(item)
}

func (g *GoogleCalendar) Insert(ctx context.Context, in EventInput) (Event, error) {
	item, err := g.service.Events.Insert(g.calendarID, toItem(in)).Context(ctx).Do()
	if err != nil {
		return Event{}, apiErr("create event", err)
	}
	return toEvent(item)
}

// Update writes her edit over the version she saw (etag); if the event
// changed since, the edit is refused rather than overwriting.
func (g *GoogleCalendar) Update(ctx context.Context, id, etag string, in EventInput) (Event, error) {
	call := g.service.Events.Patch(g.calendarID, id, toItem(in)).Context(ctx)
	call.Header().Set("If-Match", etag)
	item, err := call.Do()
	if err != nil {
		return Event{}, apiErr("update event", err)
	}
	return toEvent(item)
}

// Delete removes the event, unless it changed since she saw it (etag). A
// recurring instance is cancelled on its own, leaving the series.
func (g *GoogleCalendar) Delete(ctx context.Context, id, etag string) error {
	call := g.service.Events.Delete(g.calendarID, id).Context(ctx)
	call.Header().Set("If-Match", etag)
	return apiErr("delete event", call.Do())
}

func toItem(in EventInput) *gcal.Event {
	item := &gcal.Event{
		Summary: in.Title,
		Start:   &gcal.EventDateTime{DateTime: in.Start.Format(time.RFC3339)},
		End:     &gcal.EventDateTime{DateTime: in.End.Format(time.RFC3339)},
		ColorId: in.ColorID,
	}
	if in.ColorID == "" {
		// Sent as null, so a patch clears the colour instead of skipping it.
		item.NullFields = []string{"ColorId"}
	}
	return item
}

func apiErr(op string, err error) error {
	var gerr *googleapi.Error
	if errors.As(err, &gerr) {
		switch gerr.Code {
		case http.StatusNotFound, http.StatusGone:
			return ErrGone
		case http.StatusPreconditionFailed:
			return ErrChanged
		}
	}
	return googleauth.Wrap(op, err)
}

func toEvent(item *gcal.Event) (Event, error) {
	event := Event{
		ID:        item.Id,
		Title:     item.Summary,
		ColorID:   item.ColorId,
		Cancelled: item.Status == "cancelled",
		ETag:      item.Etag,
	}

	// Deleted instances may come back without times; they are skipped anyway.
	if item.Start == nil || item.End == nil {
		return event, nil
	}

	// All-day events carry Date instead of DateTime.
	if item.Start.DateTime == "" {
		event.AllDay = true
		return event, nil
	}

	start, err := time.Parse(time.RFC3339, item.Start.DateTime)
	if err != nil {
		return event, fmt.Errorf("event %s start: %w", item.Id, err)
	}
	end, err := time.Parse(time.RFC3339, item.End.DateTime)
	if err != nil {
		return event, fmt.Errorf("event %s end: %w", item.Id, err)
	}

	event.Start, event.End = start.UTC(), end.UTC()
	return event, nil
}
