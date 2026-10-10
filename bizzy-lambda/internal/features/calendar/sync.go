package calendar

import (
	"context"
	"time"

	"bizzy-lambda/internal/features/clients"
)

type EventSource interface {
	Events(ctx context.Context, from, to time.Time) ([]Event, error)
}

type ClientLister interface {
	List(ctx context.Context) ([]clients.Client, error)
}

// Syncer re-reads a fixed window of the calendar on every run instead of
// using sync tokens: running twice is harmless and a missed day heals itself.
type Syncer struct {
	Events  EventSource
	Clients ClientLister
	Window  time.Duration
	Now     func() time.Time
}

type Summary struct {
	Sessions    int `json:"sessions"`
	Unmatched   int `json:"unmatched"`
	ParseErrors int `json:"parseErrors"`
	Skipped     int `json:"skipped"`
}

// Run classifies every event in the window.
//
// Not yet persisted: the next step is a sessions repository that upserts by
// event ID, leaves invoiced sessions alone (flagging drift), removes deleted
// events, and then reapplies package credits in date order.
func (s Syncer) Run(ctx context.Context) (Summary, error) {
	var summary Summary

	all, err := s.Clients.List(ctx)
	if err != nil {
		return summary, err
	}
	aliases := AliasesOf(all)

	to := s.Now()
	events, err := s.Events.Events(ctx, to.Add(-s.Window), to)
	if err != nil {
		return summary, err
	}

	for _, event := range events {
		switch Classify(event, aliases).Outcome {
		case OutcomeSession:
			summary.Sessions++
		case OutcomeUnmatched:
			summary.Unmatched++
		case OutcomeParseError:
			summary.ParseErrors++
		case OutcomeSkip:
			summary.Skipped++
		}
	}

	return summary, nil
}
