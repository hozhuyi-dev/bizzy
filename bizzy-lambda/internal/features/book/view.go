package book

import (
	"context"

	"bizzy-lambda/internal/features/packages"
	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/platform/command"
	"bizzy-lambda/internal/platform/statemodel"
	"bizzy-lambda/internal/shared/money"
)

// The views' verdicts (an entity's `can`) are the book's guards deciding
// the action on the book as it is, without committing: so the app offers
// exactly what the API would take, with the same refusal.

// verdict is what deciding cmd on b says.
func verdict(b *Book, cmd Command) statemodel.Verdict {
	_, violations, err := Decide(b, cmd)
	if err != nil {
		return statemodel.Check(err)
	}
	return statemodel.Check(command.Err(violations))
}

// probePayment is any payment, to ask whether one can be recorded.
var probePayment = money.Input{Method: money.MethodCash}

// SessionCan is what the book says of the actions on one of its sessions.
func (b *Book) SessionCan(id string) sessions.Can {
	item := []Item{{Kind: ItemSession, ID: id}}
	return sessions.Can{
		Pay:         verdict(b, SetPayment{Items: item, Payment: &probePayment}),
		UndoPayment: verdict(b, SetPayment{Items: item}),
		Delete:      verdict(b, DeleteSession{ID: id, KeepPackage: true}),
	}
}

// PackageCan is what the book says of the actions on one of its packages.
func (b *Book) PackageCan(id string) packages.Can {
	item := []Item{{Kind: ItemPackage, ID: id}}
	return packages.Can{
		Pay:            verdict(b, SetPayment{Items: item, Payment: &probePayment}),
		UndoPayment:    verdict(b, SetPayment{Items: item}),
		Edit:           statemodel.Verdict{OK: true},
		Delete:         verdict(b, DeletePackage{ID: id}),
		MakeStandalone: verdict(b, MakeStandalone{ID: id}),
	}
}

// books loads each client's book once.
type books struct {
	x     Executor
	cache map[string]*Book
}

func (bs *books) of(ctx context.Context, clientID string) (*Book, error) {
	if b, ok := bs.cache[clientID]; ok {
		return b, nil
	}
	b, err := bs.x.Load(ctx, Scope{Clients: []string{clientID}})
	if err != nil {
		return nil, err
	}
	bs.cache[clientID] = b
	return b, nil
}

// JudgeSessions is sessions.Judge.
func (x Executor) JudgeSessions(ctx context.Context, all []sessions.Session) (map[string]sessions.Can, error) {
	bs := &books{x: x, cache: map[string]*Book{}}
	out := make(map[string]sessions.Can, len(all))
	for _, s := range all {
		b, err := bs.of(ctx, s.ClientID)
		if err != nil {
			return nil, err
		}
		if _, ok := b.Sessions[s.ID]; ok {
			out[s.ID] = b.SessionCan(s.ID)
		}
	}
	return out, nil
}

// JudgePackages is packages.Judge.
func (x Executor) JudgePackages(ctx context.Context, all []packages.Package) (map[string]packages.Can, error) {
	bs := &books{x: x, cache: map[string]*Book{}}
	out := make(map[string]packages.Can, len(all))
	for _, p := range all {
		b, err := bs.of(ctx, p.ClientID)
		if err != nil {
			return nil, err
		}
		if _, ok := b.Packages[p.ID]; ok {
			out[p.ID] = b.PackageCan(p.ID)
		}
	}
	return out, nil
}
