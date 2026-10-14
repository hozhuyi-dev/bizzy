package todo

import (
	"slices"
	"testing"
	"time"

	"bizzy-lambda/internal/features/conflicts"
	"bizzy-lambda/internal/features/followups"
	"bizzy-lambda/internal/features/packages"
	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/shared/docref"
	"bizzy-lambda/internal/shared/money"
)

func TestBuildMergesByWhen(t *testing.T) {
	now := time.Date(2026, 10, 12, 9, 0, 0, 0, time.UTC)
	at := func(hours int) time.Time { return now.Add(time.Duration(hours) * time.Hour) }
	invoice := &docref.Ref{DocumentID: "d"}

	open := []sessions.View{
		// Happened yesterday: record and collect.
		(sessions.Session{ID: "past", Start: at(-24), End: at(-23), FeeCents: 9500, Invoice: invoice}).View(now, sessions.Can{}),
		// Tentative tomorrow: confirm.
		(sessions.Session{ID: "maybe", Start: at(24), End: at(25), Tentative: true, FeeCents: 9500, Invoice: invoice}).View(now, sessions.Can{}),
		// Booked tomorrow: in the index, nothing to do yet.
		(sessions.Session{ID: "booked", Start: at(26), End: at(27), FeeCents: 9500, Invoice: invoice}).View(now, sessions.Can{}),
	}
	done := now
	due := []followups.FollowUp{
		{ID: "call", Due: at(2)},
		{ID: "done", Due: at(1), DoneAt: &done},
	}
	unpaid := []packages.View{
		// Bought on its own this morning, unpaid: collect.
		(packages.Package{ID: "own", PriceCents: 85000, Sessions: 10, PurchasedAt: at(-3), Invoice: invoice}).View(now, packages.Can{}),
		// Bought in a session: collected on that session instead.
		(packages.Package{ID: "bought", BoughtIn: "past", PriceCents: 85000, Sessions: 10, PurchasedAt: at(-24), Invoice: invoice}).View(now, packages.Can{}),
		// Paid, with credits left: nothing to do.
		(packages.Package{ID: "paid", PriceCents: 85000, Sessions: 10, PurchasedAt: at(-2), Invoice: invoice, Paid: &money.Paid{AmountCents: 85000}}).View(now, packages.Can{}),
	}
	waiting := []conflicts.Conflict{{Key: "calendar#e1", Kind: conflicts.KindChanged, TargetID: "x", At: at(-1)}}

	items := Build(open, unpaid, due, waiting)
	var got []string
	for _, it := range items {
		switch it.Kind {
		case KindSession:
			got = append(got, "session "+it.Session.ID)
		case KindPackage:
			got = append(got, "package "+it.Package.ID)
		case KindFollowUp:
			got = append(got, "follow-up "+it.FollowUp.ID)
		case KindConflict:
			got = append(got, "conflict "+it.Conflict.Key)
		}
	}
	want := []string{"session past", "package own", "conflict calendar#e1", "follow-up call", "session maybe"}
	if !slices.Equal(got, want) {
		t.Errorf("items = %v, want %v", got, want)
	}
}
