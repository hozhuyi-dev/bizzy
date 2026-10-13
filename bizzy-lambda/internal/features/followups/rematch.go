package followups

import (
	"context"
	"errors"

	"bizzy-lambda/internal/features/clients"
	"bizzy-lambda/internal/platform/dynamo"
)

type RematchStore interface {
	Get(ctx context.Context, eventID string) (FollowUp, bool, error)
	ListWithoutClient(ctx context.Context) ([]FollowUp, error)
	ListByClient(ctx context.Context, clientID string) ([]FollowUp, error)
	Save(ctx context.Context, f FollowUp) (FollowUp, error)
}

// Rematch re-reads the follow-ups a save of client clientID can change
// against every client's aliases, as sessions are reconciled: one no client
// matched (done or not) may now be theirs, and one of theirs may no longer
// be.
func Rematch(ctx context.Context, repo RematchStore, all []clients.Client, clientID string) error {
	aliases := clients.AliasesOf(all)
	unmatched, err := repo.ListWithoutClient(ctx)
	if err != nil {
		return err
	}
	theirs, err := repo.ListByClient(ctx, clientID)
	if err != nil {
		return err
	}
	for _, f := range append(unmatched, theirs...) {
		if err := rematch(ctx, repo, f, aliases); err != nil {
			return err
		}
	}
	return nil
}

// rematch saves f re-matched when that changes it, reading it afresh if it
// changed meanwhile (a sync, or she marked it done).
func rematch(ctx context.Context, repo RematchStore, f FollowUp, aliases clients.Aliases) error {
	for attempt := 0; ; attempt++ {
		matched := f.Match(aliases)
		if matched.ClientID == f.ClientID && matched.SuggestedClientID == f.SuggestedClientID && matched.Problem == f.Problem {
			return nil
		}
		_, err := repo.Save(ctx, matched)
		if !errors.Is(err, dynamo.ErrConflict) || attempt >= 3 {
			return err
		}
		fresh, found, err := repo.Get(ctx, f.EventID)
		if err != nil || !found {
			return err
		}
		f = fresh
	}
}
