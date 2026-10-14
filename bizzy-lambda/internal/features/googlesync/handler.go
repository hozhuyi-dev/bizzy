package googlesync

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"time"

	"bizzy-lambda/internal/features/conflicts"
	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/platform/command"
	"bizzy-lambda/internal/router"
)

// StatusHistory keeps the last run.
type StatusHistory = StatusStore

// Register serves the sync and its last run. The app runs it on load and
// whenever she taps "Sync now".
func Register(r *router.Router, repo StatusHistory, loc *time.Location, run func(ctx context.Context, r Range) (Summary, error), now func() time.Time) {
	r.Query("sync.status", func(ctx context.Context, _ json.RawMessage) (any, error) {
		return repo.Get(ctx)
	})
	r.Mutation("sync.run", router.Typed(func(ctx context.Context, in RunInput) (any, error) {
		rng, err := in.Range(loc, now())
		if err != nil {
			return nil, err
		}
		summary, err := run(ctx, rng)
		if err == nil {
			slog.InfoContext(ctx, "calendar sync", "range", in, "summary", summary)
			return summary, nil
		}

		// Recorded so the app shows why, including for the sync on load.
		message := "The sync failed. Please try again."
		var appErr *apperr.Error
		if errors.As(err, &appErr) {
			message = appErr.Message
		}
		if putErr := repo.Put(ctx, Run{At: now().UTC(), Error: message}); putErr != nil {
			slog.ErrorContext(ctx, "record sync failure", "error", putErr)
		}
		return nil, err
	}))
}

// RunInput is the dates she picked, both included, in her time zone. With
// neither, the run covers the last SyncWindow; All reads the whole calendar.
type RunInput struct {
	From string `json:"from,omitempty"`
	To   string `json:"to,omitempty"`
	All  bool   `json:"all,omitempty"`
}

func (in RunInput) Range(loc *time.Location, now time.Time) (Range, error) {
	switch {
	case in.All:
		return Range{}, nil
	case in.From == "" && in.To == "":
		return Range{From: now.Add(-SyncWindow)}, nil
	}

	from, err := time.ParseInLocation(time.DateOnly, in.From, loc)
	if err != nil {
		return Range{}, apperr.Invalid("pick a start date")
	}
	if in.To == "" {
		return Range{From: from}, nil
	}
	to, err := time.ParseInLocation(time.DateOnly, in.To, loc)
	if err != nil {
		return Range{}, apperr.Invalid("pick an end date")
	}
	if to.Before(from) {
		return Range{}, apperr.Invalid("the end date is before the start date")
	}
	return Range{From: from, To: to.AddDate(0, 0, 1)}, nil
}

// RegisterConflicts serves what settles an edit she made in the calendar
// that bizzy didn't apply: undo it there, apply it once a remedy allows it,
// or say a new event isn't bizzy's.
func RegisterConflicts(r *router.Router, sy Syncer) {
	r.Mutation("calendar.revert", router.Typed(sy.revert))
	r.Mutation("conflicts.apply", router.Typed(sy.apply))
	r.Mutation("calendar.ignore", router.Typed(sy.ignore))
}

type keyInput struct {
	// Key is the conflict's ("calendar#<eventId>").
	Key string `json:"key"`
}

var errSettled = apperr.NotFound("This was settled already.")

func (sy Syncer) conflict(ctx context.Context, key string) (conflicts.Conflict, error) {
	c, found, err := sy.Conflicts.Get(ctx, key)
	if err != nil {
		return c, err
	}
	if !found {
		return c, errSettled
	}
	return c, nil
}

// revert writes the session or follow-up back over her edit: its event as
// it is, or back from the trash.
func (sy Syncer) revert(ctx context.Context, in keyInput) (any, error) {
	c, err := sy.conflict(ctx, in.Key)
	if err != nil {
		return nil, err
	}
	if c.Kind == conflicts.KindNew {
		return nil, apperr.Conflict("This event shows nothing of bizzy's yet: make it readable, or say it isn't bizzy's.")
	}
	cal, err := sy.Calendar(ctx)
	if err != nil {
		return nil, err
	}
	return nil, sy.push(ctx, cal, target{conflicts.ExternalKind(c.TargetKind), c.TargetID}, pushRevert)
}

// apply reads her edit again, as a sync would, and applies it if nothing
// stands in the way now; else it is refused with what still does.
func (sy Syncer) apply(ctx context.Context, in keyInput) (any, error) {
	c, err := sy.conflict(ctx, in.Key)
	if err != nil {
		return nil, err
	}
	if err := sy.Event(withApplying(ctx, in.Key), c.ExternalID, &Summary{}); err != nil {
		return nil, err
	}
	if c, found, err := sy.Conflicts.Get(ctx, in.Key); err != nil {
		return nil, err
	} else if found {
		return nil, refused(c)
	}
	return nil, nil
}

// ignore says a new event isn't bizzy's: the sync leaves it alone.
func (sy Syncer) ignore(ctx context.Context, in keyInput) (any, error) {
	c, err := sy.conflict(ctx, in.Key)
	if err != nil {
		return nil, err
	}
	if c.Kind != conflicts.KindNew {
		return nil, apperr.Conflict("This event shows a session or follow-up: undo the edit, or apply it.")
	}
	if err := sy.Conflicts.PutExternal(ctx, conflicts.External{Surface: c.Surface, ExternalID: c.ExternalID, Kind: conflicts.Ignored}); err != nil {
		return nil, err
	}
	return nil, sy.Conflicts.Delete(ctx, c.Key)
}

// refused is what a conflict says to the app, when she asks to apply it
// and it still can't be.
func refused(c conflicts.Conflict) error {
	return command.Err(c.Violations)
}
