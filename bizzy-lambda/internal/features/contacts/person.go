// Package contacts connects clients to the user's Google contacts. Contact
// details live in Google, so they are on the user's phone too; bizzy links
// each client to a contact, keeps a read-only copy for lists and receipts
// (clients.Contact), and writes edits straight back to Google.
package contacts

import (
	"context"
	"strings"
	"time"

	"bizzy-lambda/internal/features/clients"
)

// Directory is the user's Google contacts: Google in production (see
// google.go), fakecontacts in tests.
type Directory interface {
	List(ctx context.Context) ([]Person, error)
	Get(ctx context.Context, resourceName string) (Person, error)
	Create(ctx context.Context, d Details) (Person, error)
	Update(ctx context.Context, resourceName, etag string, d Details) (Person, error)
	// Label adds the contact to the "Clients" label.
	Label(ctx context.Context, resourceName string) error
}

// Person is what bizzy reads from one Google contact: its primary email,
// phone and address.
type Person struct {
	ResourceName string   `json:"resourceName"`
	ETag         string   `json:"etag"`
	DisplayName  string   `json:"displayName,omitempty"`
	GivenName    string   `json:"givenName,omitempty"`
	FamilyName   string   `json:"familyName,omitempty"`
	Nicknames    []string `json:"nicknames,omitempty"`
	Email        string   `json:"email,omitempty"`
	Phone        string   `json:"phone,omitempty"`
	Address      Address  `json:"address"`
}

type Address struct {
	// Street may run over several lines.
	Street   string `json:"street,omitempty"`
	City     string `json:"city,omitempty"`
	Postcode string `json:"postcode,omitempty"`
	Region   string `json:"region,omitempty"`
	// Formatted is the whole address as Google prints it.
	Formatted string `json:"formatted,omitempty"`
}

// Link is the copy of the contact a client keeps.
func (p Person) Link(now time.Time) clients.Contact {
	return clients.Contact{
		ResourceName: p.ResourceName,
		ETag:         p.ETag,
		DisplayName:  p.DisplayName,
		Email:        p.Email,
		Phone:        p.Phone,
		Address:      p.Address.Formatted,
		Postcode:     p.Address.Postcode,
		SyncedAt:     now.UTC(),
	}
}

// Details are the fields the user edits from the app. The name is only set when
// a contact is created; renaming happens in Google Contacts.
type Details struct {
	GivenName  string  `json:"givenName,omitempty"`
	FamilyName string  `json:"familyName,omitempty"`
	Email      string  `json:"email"`
	Phone      string  `json:"phone"`
	Address    Address `json:"address"`
}

func (d Details) trimmed() Details {
	return Details{
		GivenName:  strings.TrimSpace(d.GivenName),
		FamilyName: strings.TrimSpace(d.FamilyName),
		Email:      strings.TrimSpace(d.Email),
		Phone:      strings.TrimSpace(d.Phone),
		Address: Address{
			Street:   strings.TrimSpace(d.Address.Street),
			City:     strings.TrimSpace(d.Address.City),
			Postcode: strings.TrimSpace(d.Address.Postcode),
			Region:   strings.TrimSpace(d.Address.Region),
		},
	}
}

func (a Address) empty() bool {
	return a.Street == "" && a.City == "" && a.Postcode == "" && a.Region == ""
}
