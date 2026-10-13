package contacts

import (
	"context"
	"log/slog"
	"time"

	"bizzy-lambda/internal/features/clients"
)

// Linker reads a contact for a client to link to, and adds it to the
// "Clients" label. It implements clients.Linker.
type Linker struct {
	Dir Directory
	Now func() time.Time
}

func (l Linker) Link(ctx context.Context, resourceName string) (clients.Contact, error) {
	person, err := l.Dir.Get(ctx, resourceName)
	if err != nil {
		return clients.Contact{}, err
	}
	// The label is a convenience on her phone; a failure must not stop the
	// client being saved.
	if err := l.Dir.Label(ctx, resourceName); err != nil {
		slog.WarnContext(ctx, "label contact", "resourceName", resourceName, "error", err)
	}
	return person.Link(l.Now()), nil
}
