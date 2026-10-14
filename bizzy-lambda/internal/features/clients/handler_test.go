package clients

import (
	"context"
	"errors"
	"slices"
	"testing"
	"time"

	"bizzy-lambda/internal/platform/apperr"
)

type memoryStore struct {
	clients []Client
}

func (m *memoryStore) List(context.Context) ([]Client, error) { return m.clients, nil }

func (m *memoryStore) Get(_ context.Context, id string) (Client, bool, error) {
	for _, c := range m.clients {
		if c.ID == id {
			return c, true, nil
		}
	}
	return Client{}, false, nil
}

func (m *memoryStore) SetContacted(_ context.Context, id string, at *time.Time) error {
	for i, c := range m.clients {
		if c.ID == id {
			m.clients[i].LastContactedAt = at
		}
	}
	return nil
}

func (m *memoryStore) SaveProfile(_ context.Context, client Client) error {
	for i, existing := range m.clients {
		if existing.ID == client.ID {
			m.clients[i] = client
			return nil
		}
	}
	m.clients = append(m.clients, client)
	return nil
}

type fakeLinker map[string]Contact

func (f fakeLinker) Link(_ context.Context, resourceName string) (Contact, error) {
	contact, ok := f[resourceName]
	if !ok {
		return Contact{}, apperr.NotFound("contact not found")
	}
	return contact, nil
}

var (
	linker = fakeLinker{
		"people/jane": {ResourceName: "people/jane", ETag: "e1", Phone: "012"},
		"people/john": {ResourceName: "people/john", ETag: "e2"},
	}
	janeLink = &Contact{ResourceName: "people/jane"}
)

func TestSave(t *testing.T) {
	ctx := context.Background()

	t.Run("creates with normalised aliases including the name", func(t *testing.T) {
		h := handler{repo: &memoryStore{}, contacts: linker, impact: allowAll{}, loc: time.UTC, now: time.Now}

		out, err := h.save(ctx, saveInput{Client: Client{Name: "  Jane   Smith ", Aliases: []string{"JANE S", "jane smith", " "}, Contact: janeLink}})
		if err != nil {
			t.Fatalf("save error: %v", err)
		}

		got := out.(View).Client
		if got.ID == "" {
			t.Error("expected an id to be assigned")
		}
		if got.Name != "Jane Smith" {
			t.Errorf("Name = %q", got.Name)
		}
		if want := []string{"jane smith", "jane s"}; !slices.Equal(got.Aliases, want) {
			t.Errorf("Aliases = %v, want %v", got.Aliases, want)
		}
		if got.Contact == nil || got.Contact.Phone != "012" {
			t.Errorf("Contact = %+v, want the details copied from Google", got.Contact)
		}
	})

	t.Run("requires a contact for a new client", func(t *testing.T) {
		h := handler{repo: &memoryStore{}, contacts: linker, impact: allowAll{}, loc: time.UTC, now: time.Now}
		_, err := h.save(ctx, saveInput{Client: Client{Name: "Jane"}})
		assertCode(t, err, apperr.CodeInvalid)
	})

	t.Run("unlinks an existing client sent without a contact", func(t *testing.T) {
		h := handler{repo: &memoryStore{clients: []Client{{ID: "a", Name: "Jane", Aliases: []string{"jane"}, Contact: janeLink}}}, contacts: linker, impact: allowAll{}, loc: time.UTC, now: time.Now}
		out, err := h.save(ctx, saveInput{Client: Client{ID: "a", Name: "Jane"}})
		if err != nil {
			t.Fatalf("save error: %v", err)
		}
		if got := out.(View).Client.Contact; got != nil {
			t.Errorf("Contact = %+v, want unlinked", got)
		}
	})

	t.Run("keeps the contact copy when the link is unchanged", func(t *testing.T) {
		kept := &Contact{ResourceName: "people/jane", ETag: "old", Phone: "999"}
		h := handler{repo: &memoryStore{clients: []Client{{ID: "a", Name: "Jane", Aliases: []string{"jane"}, Contact: kept}}}, contacts: linker, impact: allowAll{}, loc: time.UTC, now: time.Now}
		out, err := h.save(ctx, saveInput{Client: Client{ID: "a", Name: "Jane", Contact: &Contact{ResourceName: "people/jane", Phone: "typed in the browser"}}})
		if err != nil {
			t.Fatalf("save error: %v", err)
		}
		if got := out.(View).Client.Contact; got.Phone != "999" {
			t.Errorf("Contact = %+v, want the stored copy", got)
		}
	})

	t.Run("relinking copies the new contact", func(t *testing.T) {
		h := handler{repo: &memoryStore{clients: []Client{{ID: "a", Name: "Jane", Aliases: []string{"jane"}, Contact: janeLink}}}, contacts: linker, impact: allowAll{}, loc: time.UTC, now: time.Now}
		out, err := h.save(ctx, saveInput{Client: Client{ID: "a", Name: "Jane", Contact: &Contact{ResourceName: "people/john"}}})
		if err != nil {
			t.Fatalf("save error: %v", err)
		}
		if got := out.(View).Client.Contact; got.ResourceName != "people/john" || got.ETag != "e2" {
			t.Errorf("Contact = %+v, want people/john", got)
		}
	})

	t.Run("rejects a missing name", func(t *testing.T) {
		h := handler{repo: &memoryStore{}, contacts: linker, impact: allowAll{}, loc: time.UTC, now: time.Now}
		_, err := h.save(ctx, saveInput{Client: Client{Name: "  "}})
		assertCode(t, err, apperr.CodeInvalid)
	})

	t.Run("rejects an alias owned by another client", func(t *testing.T) {
		h := handler{repo: &memoryStore{clients: []Client{{ID: "a", Name: "Jane Smith", Aliases: []string{"jane smith", "js"}}}}, contacts: linker, impact: allowAll{}, loc: time.UTC, now: time.Now}
		_, err := h.save(ctx, saveInput{Client: Client{Name: "John Stone", Aliases: []string{"JS"}, Contact: janeLink}})
		assertCode(t, err, apperr.CodeConflict)
	})

	t.Run("runs the after-save hook with the client id", func(t *testing.T) {
		var got string
		h := handler{repo: &memoryStore{}, contacts: linker, impact: allowAll{}, loc: time.UTC, now: time.Now, afterSave: func(_ context.Context, id string) error {
			got = id
			return nil
		}}
		out, err := h.save(ctx, saveInput{Client: Client{Name: "Jane", Contact: janeLink}})
		if err != nil {
			t.Fatalf("save error: %v", err)
		}
		if got == "" || got != out.(View).Client.ID {
			t.Errorf("hook got %q, want %q", got, out.(View).Client.ID)
		}
	})

	t.Run("updating a client keeps its own aliases", func(t *testing.T) {
		h := handler{repo: &memoryStore{clients: []Client{{ID: "a", Name: "Jane Smith", Aliases: []string{"jane smith"}, Contact: janeLink}}}, contacts: linker, impact: allowAll{}, loc: time.UTC, now: time.Now}
		if _, err := h.save(ctx, saveInput{Client: Client{ID: "a", Name: "Jane Smith", Aliases: []string{"jane"}, Contact: janeLink}}); err != nil {
			t.Fatalf("save error: %v", err)
		}
	})
}

func assertCode(t *testing.T, err error, code apperr.Code) {
	t.Helper()
	var appErr *apperr.Error
	if !errors.As(err, &appErr) || appErr.Code != code {
		t.Fatalf("error = %v, want code %q", err, code)
	}
}

func TestNormalizeFeeRates(t *testing.T) {
	got, err := NormalizeFeeRates([]FeeRate{{From: "2026-11-01", Cents: 11000}, {Cents: 9000}, {From: "2026-10-01", Cents: 10000}})
	if err != nil {
		t.Fatalf("error: %v", err)
	}
	want := []FeeRate{{Cents: 9000}, {From: "2026-10-01", Cents: 10000}, {From: "2026-11-01", Cents: 11000}}
	if !slices.Equal(got, want) {
		t.Errorf("rates = %v, want %v", got, want)
	}

	for name, rates := range map[string][]FeeRate{
		"first with a date":  {{From: "2026-10-01", Cents: 9000}},
		"two from the start": {{Cents: 9000}, {Cents: 10000}},
		"same day twice":     {{Cents: 9000}, {From: "2026-10-01", Cents: 1}, {From: "2026-10-01", Cents: 2}},
		"not a date":         {{Cents: 9000}, {From: "2026-13-01", Cents: 1}},
		"negative":           {{Cents: -1}},
	} {
		t.Run(name, func(t *testing.T) {
			_, err := NormalizeFeeRates(rates)
			assertCode(t, err, apperr.CodeInvalid)
		})
	}
}

// allowAll is an impact that lets every save through.
type allowAll struct{}

func (allowAll) Preview(context.Context, Client) (any, error) { return nil, nil }
func (allowAll) Check(context.Context, Client, bool) error    { return nil }
