package contacts

import (
	"cmp"
	"context"
	"errors"
	"fmt"
	"maps"
	"net/http"
	"slices"
	"strings"

	"google.golang.org/api/googleapi"
	"google.golang.org/api/option"
	people "google.golang.org/api/people/v1"

	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/platform/googleauth"
)

const (
	personFields = "names,nicknames,emailAddresses,phoneNumbers,addresses,metadata"
	editedFields = "emailAddresses,phoneNumbers,addresses"
	// LabelName is the Google Contacts label linked clients are added to, so
	// the user can find them on their phone.
	LabelName = "Clients"
)

var errChanged = apperr.Conflict("This contact was changed in Google meanwhile. Check the latest details and save again.")

// Google reads and writes the user's contacts through the People API.
type Google struct {
	client func(ctx context.Context) (*http.Client, error)
}

// NewGoogle takes how to get an HTTP client that acts as the user (see
// googleauth), asked for on every call since the user can reconnect any time.
func NewGoogle(client func(ctx context.Context) (*http.Client, error)) *Google {
	return &Google{client: client}
}

func (g *Google) service(ctx context.Context) (*people.Service, error) {
	client, err := g.client(ctx)
	if err != nil {
		return nil, err
	}
	return people.NewService(ctx, option.WithHTTPClient(client))
}

// List returns all the user's contacts, by name.
func (g *Google) List(ctx context.Context) ([]Person, error) {
	svc, err := g.service(ctx)
	if err != nil {
		return nil, err
	}

	all := []Person{}
	err = svc.People.Connections.List("people/me").
		PersonFields(personFields).
		PageSize(1000).
		Pages(ctx, func(page *people.ListConnectionsResponse) error {
			for _, p := range page.Connections {
				all = append(all, toPerson(p))
			}
			return nil
		})
	if err != nil {
		return nil, googleauth.Wrap("list contacts", err)
	}

	slices.SortFunc(all, func(a, b Person) int {
		return cmp.Compare(strings.ToLower(a.DisplayName), strings.ToLower(b.DisplayName))
	})
	return all, nil
}

func (g *Google) Get(ctx context.Context, resourceName string) (Person, error) {
	svc, err := g.service(ctx)
	if err != nil {
		return Person{}, err
	}
	p, err := svc.People.Get(resourceName).PersonFields(personFields).Context(ctx).Do()
	if err != nil {
		return Person{}, apiErr("get contact", err)
	}
	return toPerson(p), nil
}

func (g *Google) Create(ctx context.Context, d Details) (Person, error) {
	svc, err := g.service(ctx)
	if err != nil {
		return Person{}, err
	}

	p := &people.Person{Names: []*people.Name{{GivenName: d.GivenName, FamilyName: d.FamilyName}}}
	p.EmailAddresses = setEmail(nil, d.Email)
	p.PhoneNumbers = setPhone(nil, d.Phone)
	p.Addresses = setAddress(nil, d.Address)

	created, err := svc.People.CreateContact(p).PersonFields(personFields).Context(ctx).Do()
	if err != nil {
		return Person{}, apiErr("create contact", err)
	}
	return toPerson(created), nil
}

// Update writes the user's edits to the contact's primary email, phone and
// address, keeping its other entries. etag is the version the user edited; if
// the contact changed since, the edit is refused rather than overwriting.
func (g *Google) Update(ctx context.Context, resourceName, etag string, d Details) (Person, error) {
	svc, err := g.service(ctx)
	if err != nil {
		return Person{}, err
	}

	current, err := svc.People.Get(resourceName).PersonFields(personFields).Context(ctx).Do()
	if err != nil {
		return Person{}, apiErr("get contact", err)
	}
	if contactETag(current) != etag {
		return Person{}, errChanged
	}

	// The sources carry the etag Google checks, so a change landing between
	// the read above and this write is refused too.
	update := &people.Person{
		ResourceName:   resourceName,
		Etag:           current.Etag,
		Metadata:       current.Metadata,
		EmailAddresses: setEmail(current.EmailAddresses, d.Email),
		PhoneNumbers:   setPhone(current.PhoneNumbers, d.Phone),
		Addresses:      setAddress(current.Addresses, d.Address),
	}
	updated, err := svc.People.UpdateContact(resourceName, update).
		UpdatePersonFields(editedFields).
		PersonFields(personFields).
		Context(ctx).
		Do()
	if err != nil {
		return Person{}, apiErr("update contact", err)
	}
	return toPerson(updated), nil
}

// Label adds the contact to the "Clients" label, creating the label the
// first time.
func (g *Google) Label(ctx context.Context, resourceName string) error {
	svc, err := g.service(ctx)
	if err != nil {
		return err
	}
	group, err := label(ctx, svc, LabelName, true)
	if err != nil {
		return err
	}
	_, err = svc.ContactGroups.Members.Modify(group, &people.ModifyContactGroupMembersRequest{
		ResourceNamesToAdd: []string{resourceName},
	}).Context(ctx).Do()
	return googleauth.Wrap("label contact", err)
}

// label is the resource name of the user's label called name, made the
// first time when create is set; "" when there is none.
func label(ctx context.Context, svc *people.Service, name string, create bool) (string, error) {
	group := ""
	err := svc.ContactGroups.List().PageSize(1000).Pages(ctx, func(page *people.ListContactGroupsResponse) error {
		for _, cg := range page.ContactGroups {
			if cg.GroupType == "USER_CONTACT_GROUP" && cg.Name == name {
				group = cg.ResourceName
			}
		}
		return nil
	})
	if err != nil || group != "" || !create {
		return group, googleauth.Wrap("list labels", err)
	}
	created, err := svc.ContactGroups.Create(&people.CreateContactGroupRequest{
		ContactGroup: &people.ContactGroup{Name: name},
	}).Context(ctx).Do()
	if err != nil {
		return "", googleauth.Wrap("create label", err)
	}
	return created.ResourceName, nil
}

// What People API batches take at most.
const (
	maxCreates = 200
	maxDeletes = 500
	maxMembers = 1000
)

// clientKey tags a contact CreateLabelled made with what it was made for.
const clientKey = "bizzy"

// CreateLabelled makes a contact for each of details, keyed by what each
// is for (a client's id), all under the label called name, made if need
// be. It returns each one's contact by its key. data:copy makes a test
// account's contacts with it.
func (g *Google) CreateLabelled(ctx context.Context, name string, details map[string]Details) (map[string]Person, error) {
	svc, err := g.service(ctx)
	if err != nil {
		return nil, err
	}
	group, err := label(ctx, svc, name, true)
	if err != nil {
		return nil, err
	}
	var all []*people.ContactToCreate
	for _, key := range slices.Sorted(maps.Keys(details)) {
		d := details[key]
		p := &people.Person{
			Names:      []*people.Name{{GivenName: d.GivenName, FamilyName: d.FamilyName}},
			ClientData: []*people.ClientData{{Key: clientKey, Value: key}},
			Memberships: []*people.Membership{{
				ContactGroupMembership: &people.ContactGroupMembership{ContactGroupResourceName: group},
			}},
		}
		p.EmailAddresses = setEmail(nil, d.Email)
		p.PhoneNumbers = setPhone(nil, d.Phone)
		p.Addresses = setAddress(nil, d.Address)
		all = append(all, &people.ContactToCreate{ContactPerson: p})
	}
	made := map[string]Person{}
	for batch := range slices.Chunk(all, maxCreates) {
		out, err := svc.People.BatchCreateContacts(&people.BatchCreateContactsRequest{
			Contacts: batch, ReadMask: personFields + ",clientData",
		}).Context(ctx).Do()
		if err != nil {
			return made, googleauth.Wrap("create contacts", err)
		}
		for _, r := range out.CreatedPeople {
			if r.Person == nil {
				continue
			}
			for _, cd := range r.Person.ClientData {
				if cd.Key == clientKey {
					made[cd.Value] = toPerson(r.Person)
				}
			}
		}
	}
	return made, nil
}

// DeleteLabelled deletes every contact under the label called name, and
// returns how many it deleted.
func (g *Google) DeleteLabelled(ctx context.Context, name string) (int, error) {
	svc, err := g.service(ctx)
	if err != nil {
		return 0, err
	}
	group, err := label(ctx, svc, name, false)
	if err != nil || group == "" {
		return 0, err
	}
	// A label lists at most maxMembers at once; reading it again also
	// bounds a label slow to show what was deleted.
	deleted := 0
	for range 20 {
		cg, err := svc.ContactGroups.Get(group).MaxMembers(maxMembers).Context(ctx).Do()
		if err != nil {
			return deleted, googleauth.Wrap("read label", err)
		}
		if len(cg.MemberResourceNames) == 0 {
			return deleted, nil
		}
		for batch := range slices.Chunk(cg.MemberResourceNames, maxDeletes) {
			_, err := svc.People.BatchDeleteContacts(&people.BatchDeleteContactsRequest{ResourceNames: batch}).Context(ctx).Do()
			if err != nil {
				return deleted, googleauth.Wrap("delete contacts", err)
			}
			deleted += len(batch)
		}
	}
	return deleted, fmt.Errorf("label %s still has contacts after deleting %d", name, deleted)
}

func apiErr(op string, err error) error {
	var gerr *googleapi.Error
	if errors.As(err, &gerr) {
		switch {
		case gerr.Code == http.StatusNotFound:
			return apperr.NotFound("That contact is no longer in Google Contacts.")
		case gerr.Code == http.StatusBadRequest && strings.Contains(strings.ToLower(gerr.Body), "failed_precondition"),
			gerr.Code == http.StatusBadRequest && slices.ContainsFunc(gerr.Errors, func(e googleapi.ErrorItem) bool { return e.Reason == "failedPrecondition" }):
			return errChanged
		}
	}
	return googleauth.Wrap(op, err)
}

func toPerson(p *people.Person) Person {
	out := Person{ResourceName: p.ResourceName, ETag: contactETag(p)}

	if n := primary(p.Names, func(n *people.Name) *people.FieldMetadata { return n.Metadata }); n != nil {
		out.DisplayName, out.GivenName, out.FamilyName = n.DisplayName, n.GivenName, n.FamilyName
	}
	for _, n := range p.Nicknames {
		if n.Value != "" {
			out.Nicknames = append(out.Nicknames, n.Value)
		}
	}
	if e := primary(p.EmailAddresses, func(e *people.EmailAddress) *people.FieldMetadata { return e.Metadata }); e != nil {
		out.Email = e.Value
	}
	if ph := primary(p.PhoneNumbers, func(ph *people.PhoneNumber) *people.FieldMetadata { return ph.Metadata }); ph != nil {
		out.Phone = ph.Value
	}
	if a := primary(p.Addresses, func(a *people.Address) *people.FieldMetadata { return a.Metadata }); a != nil {
		out.Address = toAddress(a)
	}
	return out
}

func toAddress(a *people.Address) Address {
	out := Address{
		Street:    strings.TrimSpace(strings.Join(nonEmpty(a.StreetAddress, a.ExtendedAddress), "\n")),
		City:      a.City,
		Postcode:  a.PostalCode,
		Region:    a.Region,
		Formatted: a.FormattedValue,
	}
	// An address typed as one block has no structured parts; edit it as the
	// street.
	if out.empty() {
		out.Street = a.FormattedValue
	}
	if out.Formatted == "" {
		out.Formatted = strings.Join(nonEmpty(out.Street, strings.TrimSpace(out.Postcode+" "+out.City), out.Region), "\n")
	}
	return out
}

// contactETag is the version of the contact's own data, which is what
// UpdateContact checks; the person's etag also changes with their profile.
func contactETag(p *people.Person) string {
	if p.Metadata != nil {
		for _, s := range p.Metadata.Sources {
			if s.Type == "CONTACT" {
				return s.Etag
			}
		}
	}
	return p.Etag
}

// primary picks Google's primary entry, else the first.
func primary[T any](items []*T, meta func(*T) *people.FieldMetadata) *T {
	for _, item := range items {
		if m := meta(item); m != nil && m.Primary {
			return item
		}
	}
	if len(items) > 0 {
		return items[0]
	}
	return nil
}

// editable is the index of the entry an edit replaces: the contact's own
// primary entry, else its first. Entries from the person's Google profile
// can't be edited. -1 when there is none.
func editable[T any](items []*T, meta func(*T) *people.FieldMetadata) int {
	first := -1
	for i, item := range items {
		m := meta(item)
		if m != nil && m.Source != nil && m.Source.Type != "CONTACT" {
			continue
		}
		if m != nil && (m.Primary || m.SourcePrimary) {
			return i
		}
		if first < 0 {
			first = i
		}
	}
	return first
}

// set replaces, adds or (for an empty value) removes the editable entry.
func set[T any](items []*T, meta func(*T) *people.FieldMetadata, empty bool, update func(*T), create func() *T) []*T {
	i := editable(items, meta)
	switch {
	case empty && i >= 0:
		return slices.Delete(slices.Clone(items), i, i+1)
	case empty:
		return items
	case i >= 0:
		update(items[i])
		return items
	default:
		return append([]*T{create()}, items...)
	}
}

func setEmail(items []*people.EmailAddress, value string) []*people.EmailAddress {
	return set(items, func(e *people.EmailAddress) *people.FieldMetadata { return e.Metadata }, value == "",
		func(e *people.EmailAddress) { e.Value = value },
		func() *people.EmailAddress { return &people.EmailAddress{Value: value} })
}

func setPhone(items []*people.PhoneNumber, value string) []*people.PhoneNumber {
	return set(items, func(p *people.PhoneNumber) *people.FieldMetadata { return p.Metadata }, value == "",
		func(p *people.PhoneNumber) { p.Value = value },
		func() *people.PhoneNumber { return &people.PhoneNumber{Value: value} })
}

func setAddress(items []*people.Address, a Address) []*people.Address {
	return set(items, func(x *people.Address) *people.FieldMetadata { return x.Metadata }, a.empty(),
		func(x *people.Address) {
			// Left blank, Google rebuilds the formatted value from the parts.
			x.StreetAddress, x.ExtendedAddress, x.FormattedValue = a.Street, "", ""
			x.City, x.PostalCode, x.Region = a.City, a.Postcode, a.Region
		},
		func() *people.Address {
			return &people.Address{StreetAddress: a.Street, City: a.City, PostalCode: a.Postcode, Region: a.Region}
		})
}

func nonEmpty(values ...string) []string {
	return slices.DeleteFunc(values, func(v string) bool { return strings.TrimSpace(v) == "" })
}
