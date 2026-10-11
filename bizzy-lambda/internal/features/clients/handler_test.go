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

func TestSave(t *testing.T) {
	ctx := context.Background()

	t.Run("creates with normalised aliases including the name", func(t *testing.T) {
		h := handler{repo: &memoryStore{}}

		out, err := h.save(ctx, Client{Name: "  Jane   Smith ", Aliases: []string{"JANE S", "jane smith", " "}})
		if err != nil {
			t.Fatalf("save error: %v", err)
		}

		got := out.(Client)
		if got.ID == "" {
			t.Error("expected an id to be assigned")
		}
		if got.Name != "Jane Smith" {
			t.Errorf("Name = %q", got.Name)
		}
		if want := []string{"jane smith", "jane s"}; !slices.Equal(got.Aliases, want) {
			t.Errorf("Aliases = %v, want %v", got.Aliases, want)
		}
	})

	t.Run("rejects a missing name", func(t *testing.T) {
		h := handler{repo: &memoryStore{}}
		_, err := h.save(ctx, Client{Name: "  "})
		assertCode(t, err, apperr.CodeInvalid)
	})

	t.Run("rejects an alias owned by another client", func(t *testing.T) {
		h := handler{repo: &memoryStore{clients: []Client{{ID: "a", Name: "Jane Smith", Aliases: []string{"jane smith", "js"}}}}}
		_, err := h.save(ctx, Client{Name: "John Stone", Aliases: []string{"JS"}})
		assertCode(t, err, apperr.CodeConflict)
	})

	t.Run("runs the after-save hook with the client id", func(t *testing.T) {
		var got string
		h := handler{repo: &memoryStore{}, afterSave: func(_ context.Context, id string) error {
			got = id
			return nil
		}}
		out, err := h.save(ctx, Client{Name: "Jane"})
		if err != nil {
			t.Fatalf("save error: %v", err)
		}
		if got == "" || got != out.(Client).ID {
			t.Errorf("hook got %q, want %q", got, out.(Client).ID)
		}
	})

	t.Run("updating a client keeps its own aliases", func(t *testing.T) {
		h := handler{repo: &memoryStore{clients: []Client{{ID: "a", Name: "Jane Smith", Aliases: []string{"jane smith"}}}}}
		if _, err := h.save(ctx, Client{ID: "a", Name: "Jane Smith", Aliases: []string{"jane"}}); err != nil {
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
