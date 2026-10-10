package clients

import (
	"context"
	"errors"
	"slices"
	"testing"

	"bizzy-lambda/internal/platform/apperr"
)

type memoryStore struct {
	clients []Client
}

func (m *memoryStore) List(context.Context) ([]Client, error) { return m.clients, nil }

func (m *memoryStore) Put(_ context.Context, client Client) error {
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
