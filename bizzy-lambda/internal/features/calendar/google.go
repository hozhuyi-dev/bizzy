package calendar

import (
	"context"
	"fmt"
	"time"

	"golang.org/x/oauth2/google"
	gcal "google.golang.org/api/calendar/v3"
	"google.golang.org/api/option"
)

// GoogleSource reads one calendar through a service account the calendar has
// been shared with ("See all event details").
type GoogleSource struct {
	service    *gcal.Service
	calendarID string
}

func NewGoogleSource(ctx context.Context, serviceAccountJSON []byte, calendarID string) (*GoogleSource, error) {
	jwt, err := google.JWTConfigFromJSON(serviceAccountJSON, gcal.CalendarReadonlyScope)
	if err != nil {
		return nil, fmt.Errorf("parse service account key: %w", err)
	}

	service, err := gcal.NewService(ctx, option.WithHTTPClient(jwt.Client(ctx)))
	if err != nil {
		return nil, err
	}

	return &GoogleSource{service: service, calendarID: calendarID}, nil
}

// Events lists event instances starting in [from, to). Recurring events are
// expanded, and deleted instances are included so the sync can remove them.
func (g *GoogleSource) Events(ctx context.Context, from, to time.Time) ([]Event, error) {
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

	return events, err
}

func toEvent(item *gcal.Event) (Event, error) {
	event := Event{
		ID:        item.Id,
		Title:     item.Summary,
		ColorID:   item.ColorId,
		Cancelled: item.Status == "cancelled",
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
