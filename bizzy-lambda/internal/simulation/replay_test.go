package simulation

import (
	"context"
	"os"
	"sync"
	"testing"
	"time"

	"pgregory.net/rapid"

	"bizzy-lambda/internal/features/clients"
	"bizzy-lambda/internal/features/contacts"
	"bizzy-lambda/internal/features/documents"
	"bizzy-lambda/internal/features/expenses"
	"bizzy-lambda/internal/features/followups"
	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/features/settings"
	"bizzy-lambda/internal/platform/blobstore"
	"bizzy-lambda/internal/platform/dynamo"
	"bizzy-lambda/internal/platform/txn"
	"bizzy-lambda/internal/snapshot"
	"bizzy-lambda/internal/testutil/fakecal"
	"bizzy-lambda/internal/testutil/testapp"
)

// TestReplay is the simulation on a real environment's data, in memory:
// this checkout's migrations run on it, every view is read, then random
// actions run on it as on the seeded world. It only reads the environment
// (pnpm data:replay production runs it):
//
//	TABLE_NAME=… BUCKET_NAME=… go test ./internal/simulation -run TestReplay
func TestReplay(t *testing.T) {
	if os.Getenv("TABLE_NAME") == "" || os.Getenv("BUCKET_NAME") == "" {
		t.Skip("TABLE_NAME and BUCKET_NAME name the environment to replay")
	}
	snap := taken(t)
	t.Logf("took %d items at schema version %d, and %d issued PDFs", len(snap.Items), snap.Schema.Version, len(snap.PDFs))
	t.Run("views", func(t *testing.T) {
		w, err := replayed(snap)
		if err != nil {
			t.Fatal(err)
		}
		readEveryView(t, w)
	})
	t.Run("actions", func(t *testing.T) {
		rapid.Check(t, func(t *rapid.T) {
			w, err := replayed(snap)
			if err != nil {
				t.Fatal(err)
			}
			simulate(t, w)
		})
	})
}

var (
	takeOnce sync.Once
	snap     snapshot.Snapshot
	takeErr  error
)

// taken is the environment's snapshot, read once, its table's capacity
// raised for the read as its size needs.
func taken(t *testing.T) snapshot.Snapshot {
	takeOnce.Do(func() {
		ctx := context.Background()
		tb, err := dynamo.New(ctx)
		if err != nil {
			takeErr = err
			return
		}
		files, err := blobstore.NewS3(ctx, os.Getenv("BUCKET_NAME"))
		if err != nil {
			takeErr = err
			return
		}
		need, err := tb.Need(ctx, dynamo.Whole{Reads: 1})
		if err != nil {
			takeErr = err
			return
		}
		restore, err := tb.Boost(ctx, need)
		defer func() {
			if err := restore(ctx); err != nil {
				t.Errorf("%v: set it back by hand", err)
			}
		}()
		if err != nil {
			takeErr = err
			return
		}
		snap, takeErr = snapshot.Take(ctx, tb, files)
	})
	if takeErr != nil {
		t.Fatalf("take the snapshot: %v", takeErr)
	}
	return snap
}

// replayed is the world on a snapshot, migrated: its contacts in the fake
// Google Contacts as each client's copy has them, its files kept, its
// payment page published, and every session and follow-up synced into
// the (empty) fake calendar, all the way back.
func replayed(snap snapshot.Snapshot) (*World, error) {
	ctx := context.Background()
	a, _, err := testapp.From(snap.Load, time.Now().UTC().Truncate(time.Minute))
	if err != nil {
		return nil, err
	}
	w := &World{App: a}
	w.Other = &fakecal.Calendar{Name: "clinic", Now: func() time.Time { return w.Now }}
	all, err := txn.Read(ctx, w.Runner, clients.Clients.All)
	if err != nil {
		return nil, err
	}
	for _, c := range all {
		if k := c.Contact; k != nil && !k.Missing {
			w.Contacts.People = append(w.Contacts.People, contacts.Person{
				ResourceName: k.ResourceName, ETag: k.ETag, DisplayName: k.DisplayName, Email: k.Email, Phone: k.Phone,
				Address: contacts.Address{Formatted: k.Address, Postcode: k.Postcode},
			})
		}
	}
	items, err := w.Table.Scan(ctx)
	if err != nil {
		return nil, err
	}
	if _, err := snap.Files(ctx, items, w.Blobs); err != nil {
		return nil, err
	}
	if saved, err := txn.Read(ctx, w.Runner, settings.Store.All); err != nil {
		return nil, err
	} else if len(saved) > 0 {
		if err := (settings.PaySite{Store: w.PaySite, URL: testapp.PayURL}).Publish(ctx, *saved[0]); err != nil {
			return nil, err
		}
	}
	if err := w.Must("sync.run", nil, nil); err != nil {
		return nil, err
	}
	for range 600 {
		var run struct {
			Back string `json:"back"`
		}
		if err := w.Must("sync.backfill", nil, &run); err != nil {
			return nil, err
		}
		if run.Back == "" {
			break
		}
	}
	w.InSync = true
	return w, nil
}

// readEveryView reads each item's view, page and PDF, and every list, as
// the app does: one the app would show as "Something went wrong" fails.
func readEveryView(t *testing.T, w *World) {
	ctx := context.Background()
	call := func(action string, payload any) {
		if _, _, err := w.Call(action, payload); err != nil {
			t.Error(err)
		}
	}
	for _, action := range []string{
		"app.status", "settings.get", "clients.list", "packages.list", "conflicts.list", "todo.list",
		"activity.list", "expenses.catalogue", "documents.search", "expenses.search", "followUps.search",
		"sessions.search", "timeline.search",
	} {
		call(action, map[string]any{})
	}
	for year := w.Now.Year() - 2; year <= w.Now.Year(); year++ {
		call("insights.year", map[string]any{"year": year})
	}
	read := func(ids func(tx *txn.Tx) ([]string, error), each func(id string)) {
		all, err := txn.Read(ctx, w.Runner, ids)
		if err != nil {
			t.Fatal(err)
		}
		for _, id := range all {
			each(id)
		}
	}
	read(clients.Clients.IDs, func(id string) {
		call("clients.get", map[string]any{"id": id})
		call("documents.listByClient", map[string]any{"clientId": id})
		call("timeline.search", map[string]any{"clientId": id})
	})
	read(sessions.Sessions.IDs, func(id string) {
		call("sessions.get", map[string]any{"id": id})
		call("sessions.page", map[string]any{"id": id})
	})
	read(documents.Documents.IDs, func(id string) {
		call("documents.get", map[string]any{"id": id})
		call("documents.pdf", map[string]any{"id": id})
	})
	read(expenses.Expenses.IDs, func(id string) { call("expenses.get", map[string]any{"id": id}) })
	read(followups.FollowUps.IDs, func(id string) { call("followUps.get", map[string]any{"id": id}) })
}

// TestReplayOfSeeded replays the seeded world's data, as TestReplay does
// a real environment's.
func TestReplayOfSeeded(t *testing.T) {
	a := testapp.New()
	for _, c := range seedClients {
		if _, err := a.Client(c.name, nil); err != nil {
			t.Fatal(err)
		}
	}
	for _, e := range seedEvents {
		start := a.Now.Add(time.Duration(e.hours) * time.Hour)
		a.Calendar.UserAdd(e.title, start, start.Add(time.Hour))
	}
	if err := a.Must("sync.run", nil, nil); err != nil {
		t.Fatal(err)
	}
	snap, err := snapshot.Take(context.Background(), a.Table, a.Blobs)
	if err != nil {
		t.Fatal(err)
	}
	w, err := replayed(snap)
	if err != nil {
		t.Fatal(err)
	}
	if len(w.Calendar.Live) == 0 {
		t.Errorf("the replay synced no events into its calendar")
	}
	readEveryView(t, w)
	rapid.Check(t, func(t *rapid.T) {
		w, err := replayed(snap)
		if err != nil {
			t.Fatal(err)
		}
		simulate(t, w)
	})
}
