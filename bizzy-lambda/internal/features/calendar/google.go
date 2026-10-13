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

	"bizzy-lambda/internal/platform/googleauth"
)

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
// A zero from reads from the start of the calendar.
func (g *GoogleCalendar) Events(ctx context.Context, from, to time.Time) ([]Event, error) {
	var events []Event

	call := g.service.Events.List(g.calendarID).
		SingleEvents(true).
		ShowDeleted(true).
		OrderBy("startTime").
		TimeMax(to.Format(time.RFC3339)).
		MaxResults(2500)
	if !from.IsZero() {
		call = call.TimeMin(from.Format(time.RFC3339))
	}

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

// Restore brings a deleted event back from Google's trash, with its ID, so
// the session stored for it keeps everything linked to it. Google keeps a
// deleted event for about 30 days; after that it is gone for good.
func (g *GoogleCalendar) Restore(ctx context.Context, id string) (Event, error) {
	item, err := g.service.Events.Patch(g.calendarID, id, &gcal.Event{Status: "confirmed"}).Context(ctx).Do()
	if err != nil {
		return Event{}, apiErr("restore event", err)
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
	item := &gcal.Event{Summary: in.Title, ColorId: in.ColorID}
	if in.Date != "" {
		day, _ := time.Parse(time.DateOnly, in.Date)
		// The end date of an all-day event is exclusive. The time is sent as
		// null, so a patch turns a timed event into an all-day one.
		item.Start = &gcal.EventDateTime{Date: in.Date, NullFields: []string{"DateTime"}}
		item.End = &gcal.EventDateTime{Date: day.AddDate(0, 0, 1).Format(time.DateOnly), NullFields: []string{"DateTime"}}
	} else {
		item.Start = &gcal.EventDateTime{DateTime: in.Start.Format(time.RFC3339), NullFields: []string{"Date"}}
		item.End = &gcal.EventDateTime{DateTime: in.End.Format(time.RFC3339), NullFields: []string{"Date"}}
	}
	if in.ColorID == "" {
		// Sent as null, so a patch clears the colour instead of skipping it.
		item.NullFields = append(item.NullFields, "ColorId")
	}
	if in.Description != nil {
		item.Description = *in.Description
		if *in.Description == "" {
			item.NullFields = append(item.NullFields, "Description")
		}
	}
	if len(in.Private) > 0 {
		item.ExtendedProperties = &gcal.EventExtendedProperties{Private: in.Private}
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
		ID:          item.Id,
		Title:       item.Summary,
		Description: item.Description,
		ColorID:     item.ColorId,
		Cancelled:   item.Status == "cancelled",
		ETag:        item.Etag,
	}
	if item.ExtendedProperties != nil && len(item.ExtendedProperties.Private) > 0 {
		event.Private = item.ExtendedProperties.Private
	}

	// Deleted instances may come back without times; they are skipped anyway.
	if item.Start == nil || item.End == nil {
		return event, nil
	}

	// All-day events carry Date instead of DateTime.
	if item.Start.DateTime == "" {
		event.AllDay = true
		event.Date = item.Start.Date
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
