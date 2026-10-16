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

// Google is one of the user's Google calendars, acting as the user (see
// googleauth).
type Google struct {
	service    *gcal.Service
	calendarID string
}

func NewGoogle(ctx context.Context, client *http.Client, calendarID string) (*Google, error) {
	service, err := gcal.NewService(ctx, option.WithHTTPClient(client))
	if err != nil {
		return nil, err
	}
	return &Google{service: service, calendarID: calendarID}, nil
}

// List is one of the calendars the user's account can see, to choose the
// one bizzy reads.
type List struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Primary bool   `json:"primary,omitempty"`
}

// Calendars lists the calendars the user's account can see.
func Calendars(ctx context.Context, client *http.Client) ([]List, error) {
	service, err := gcal.NewService(ctx, option.WithHTTPClient(client))
	if err != nil {
		return nil, err
	}
	var all []List
	err = service.CalendarList.List().Pages(ctx, func(page *gcal.CalendarList) error {
		for _, item := range page.Items {
			name := item.SummaryOverride
			if name == "" {
				name = item.Summary
			}
			all = append(all, List{ID: item.Id, Name: name, Primary: item.Primary})
		}
		return nil
	})
	return all, googleauth.Wrap("list calendars", err)
}

func (g *Google) Changed(ctx context.Context, since, from time.Time) ([]Event, error) {
	call := g.service.Events.List(g.calendarID).
		SingleEvents(true).
		ShowDeleted(true).
		TimeMin(from.Format(time.RFC3339)).
		MaxResults(2500)
	if !since.IsZero() {
		call = call.UpdatedMin(since.Format(time.RFC3339))
	}
	var events []Event
	err := call.Pages(ctx, func(page *gcal.Events) error {
		for _, item := range page.Items {
			e, err := toEvent(item)
			if err != nil {
				return err
			}
			events = append(events, e)
		}
		return nil
	})
	return events, googleauth.Wrap("list events", err)
}

func (g *Google) Get(ctx context.Context, id string) (Event, error) {
	item, err := g.service.Events.Get(g.calendarID, id).Context(ctx).Do()
	if err != nil {
		return Event{}, apiErr("get event", err)
	}
	return toEvent(item)
}

func (g *Google) Insert(ctx context.Context, in EventInput) (Event, error) {
	item, err := g.service.Events.Insert(g.calendarID, toItem(in)).Context(ctx).Do()
	if err != nil {
		return Event{}, apiErr("create event", err)
	}
	return toEvent(item)
}

func (g *Google) Update(ctx context.Context, id, etag string, in EventInput) (Event, error) {
	call := g.service.Events.Patch(g.calendarID, id, toItem(in)).Context(ctx)
	call.Header().Set("If-Match", etag)
	item, err := call.Do()
	if err != nil {
		return Event{}, apiErr("update event", err)
	}
	return toEvent(item)
}

func (g *Google) Delete(ctx context.Context, id, etag string) error {
	call := g.service.Events.Delete(g.calendarID, id).Context(ctx)
	call.Header().Set("If-Match", etag)
	return apiErr("delete event", call.Do())
}

func toItem(in EventInput) *gcal.Event {
	item := &gcal.Event{Summary: in.Title}
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
	e := Event{
		ID: item.Id, Title: item.Summary, Description: item.Description,
		Cancelled: item.Status == "cancelled", ETag: item.Etag,
	}
	if item.Updated != "" {
		e.Updated, _ = time.Parse(time.RFC3339, item.Updated)
	}
	if item.ExtendedProperties != nil && len(item.ExtendedProperties.Private) > 0 {
		e.Private = item.ExtendedProperties.Private
	}
	// Deleted instances may come back without times.
	if item.Start == nil || item.End == nil {
		return e, nil
	}
	if item.Start.DateTime == "" {
		e.AllDay, e.Date = true, item.Start.Date
		return e, nil
	}
	start, err := time.Parse(time.RFC3339, item.Start.DateTime)
	if err != nil {
		return e, fmt.Errorf("event %s start: %w", item.Id, err)
	}
	end, err := time.Parse(time.RFC3339, item.End.DateTime)
	if err != nil {
		return e, fmt.Errorf("event %s end: %w", item.Id, err)
	}
	e.Start, e.End = start.UTC(), end.UTC()
	return e, nil
}
