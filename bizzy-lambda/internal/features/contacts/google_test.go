package contacts

import (
	"testing"

	people "google.golang.org/api/people/v1"
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
