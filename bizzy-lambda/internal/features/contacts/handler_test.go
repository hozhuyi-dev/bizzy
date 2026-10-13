package contacts

import (
	"context"
	"testing"
	"time"

	"bizzy-lambda/internal/features/clients"
)

type fakeDirectory struct {
	updated Person
}

func (f *fakeDirectory) List(context.Context) ([]Person, error)          { return nil, nil }
func (f *fakeDirectory) Get(context.Context, string) (Person, error)     { return Person{}, nil }
func (f *fakeDirectory) Create(context.Context, Details) (Person, error) { return Person{}, nil }
func (f *fakeDirectory) Label(context.Context, string) error             { return nil }
func (f *fakeDirectory) Update(_ context.Context, rn, _ string, d Details) (Person, error) {
	f.updated = Person{ResourceName: rn, ETag: "e2", Phone: d.Phone}
	return f.updated, nil
}

type fakeClients struct {
	all       []clients.Client
	refreshed map[string]clients.Contact
}

func (f *fakeClients) List(context.Context) ([]clients.Client, error) { return f.all, nil }
func (f *fakeClients) RefreshContact(_ context.Context, id string, _, next clients.Contact) (bool, error) {
	f.refreshed[id] = next
	return true, nil
}

func TestUpdateRefreshesLinkedClients(t *testing.T) {
	store := &fakeClients{
		all: []clients.Client{
			{ID: "jane", Contact: &clients.Contact{ResourceName: "people/jane", ETag: "e1"}},
			{ID: "bob", Contact: &clients.Contact{ResourceName: "people/bob", ETag: "b1"}},
		},
		refreshed: map[string]clients.Contact{},
	}
	h := handler{dir: &fakeDirectory{}, clients: store, now: func() time.Time { return time.Unix(0, 0) }}

	if _, err := h.update(context.Background(), updateInput{ResourceName: "people/jane", ETag: "e1", Details: Details{Phone: " 013 "}}); err != nil {
		t.Fatal(err)
	}
	if got, ok := store.refreshed["jane"]; !ok || got.Phone != "013" || got.ETag != "e2" {
		t.Errorf("jane's copy = %+v, want the update", got)
	}
	if _, ok := store.refreshed["bob"]; ok {
		t.Error("bob is linked to another contact")
	}
}
