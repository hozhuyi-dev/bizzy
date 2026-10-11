package contacts

import (
	"context"
	"testing"
	"time"

	people "google.golang.org/api/people/v1"

	"bizzy-lambda/internal/features/clients"
)

func meta(source string, primary bool) *people.FieldMetadata {
	return &people.FieldMetadata{Primary: primary, Source: &people.Source{Type: source}}
}

func TestToPerson(t *testing.T) {
	p := toPerson(&people.Person{
		ResourceName: "people/c1",
		Etag:         "person-etag",
		Metadata:     &people.PersonMetadata{Sources: []*people.Source{{Type: "PROFILE", Etag: "p"}, {Type: "CONTACT", Etag: "contact-etag"}}},
		Names:        []*people.Name{{DisplayName: "Jane Smith", GivenName: "Jane", FamilyName: "Smith"}},
		Nicknames:    []*people.Nickname{{Value: "Janey"}},
		EmailAddresses: []*people.EmailAddress{
			{Value: "work@example.com", Metadata: meta("CONTACT", false)},
			{Value: "jane@example.com", Metadata: meta("CONTACT", true)},
		},
		PhoneNumbers: []*people.PhoneNumber{{Value: "012-345 6789"}},
		Addresses:    []*people.Address{{StreetAddress: "12 Jalan Mawar", ExtendedAddress: "Taman Melati", PostalCode: "47400", City: "Petaling Jaya", FormattedValue: "12 Jalan Mawar, 47400 Petaling Jaya"}},
	})

	if p.ETag != "contact-etag" {
		t.Errorf("ETag = %q, want the contact source's", p.ETag)
	}
	if p.DisplayName != "Jane Smith" || p.GivenName != "Jane" || len(p.Nicknames) != 1 {
		t.Errorf("names = %+v", p)
	}
	if p.Email != "jane@example.com" {
		t.Errorf("Email = %q, want the primary one", p.Email)
	}
	if p.Address.Street != "12 Jalan Mawar\nTaman Melati" || p.Address.Postcode != "47400" {
		t.Errorf("Address = %+v", p.Address)
	}
}

func TestToAddressFromOneBlock(t *testing.T) {
	a := toAddress(&people.Address{FormattedValue: "12 Jalan Mawar\n47400 Petaling Jaya"})
	if a.Street != "12 Jalan Mawar\n47400 Petaling Jaya" || a.Formatted != a.Street {
		t.Errorf("Address = %+v, want the block as the street", a)
	}
}

func TestSetKeepsOtherEntries(t *testing.T) {
	emails := []*people.EmailAddress{
		{Value: "profile@example.com", Metadata: meta("PROFILE", true)},
		{Value: "old@example.com", Type: "home", Metadata: meta("CONTACT", false)},
		{Value: "work@example.com", Metadata: meta("CONTACT", false)},
	}

	got := setEmail(emails, "new@example.com")
	if len(got) != 3 || got[1].Value != "new@example.com" || got[1].Type != "home" || got[2].Value != "work@example.com" {
		t.Errorf("replace: %v", values(got))
	}

	got = setEmail(emails, "")
	if len(got) != 2 || got[1].Value != "work@example.com" {
		t.Errorf("clear: %v", values(got))
	}

	got = setEmail(nil, "first@example.com")
	if len(got) != 1 || got[0].Value != "first@example.com" {
		t.Errorf("add: %v", values(got))
	}
}

func TestSetAddressRebuildsFormatted(t *testing.T) {
	got := setAddress([]*people.Address{{StreetAddress: "old", ExtendedAddress: "line 2", FormattedValue: "old, line 2", Country: "Malaysia"}},
		Address{Street: "12 Jalan Mawar", Postcode: "47400", City: "Petaling Jaya"})
	a := got[0]
	if a.StreetAddress != "12 Jalan Mawar" || a.ExtendedAddress != "" || a.FormattedValue != "" || a.Country != "Malaysia" {
		t.Errorf("Address = %+v", a)
	}
}

func values(emails []*people.EmailAddress) []string {
	var out []string
	for _, e := range emails {
		out = append(out, e.Value)
	}
	return out
}

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
