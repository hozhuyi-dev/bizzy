// Package fakecontacts is an in-memory Google Contacts (contacts.Directory).
// Every update bumps the contact's etag, and one against an older etag is
// refused, as Google does.
package fakecontacts

import (
	"context"
	"fmt"
	"slices"
	"strings"

	"bizzy-lambda/internal/features/contacts"
	"bizzy-lambda/internal/platform/apperr"
)

type Directory struct {
	People []contacts.Person
	// created numbers new contacts.
	created int
	// onWrite runs before each write (see memory.Store.OnWrite).
	onWrite func(op string)
}

// OnWrite sets what runs before each write, op naming it.
func (d *Directory) OnWrite(hook func(op string)) { d.onWrite = hook }

func (d *Directory) beforeWrite(op string) {
	if d.onWrite != nil {
		d.onWrite(op)
	}
}

func (d *Directory) Find(resourceName string) int {
	return slices.IndexFunc(d.People, func(p contacts.Person) bool { return p.ResourceName == resourceName })
}

func (d *Directory) List(context.Context) ([]contacts.Person, error) {
	return slices.Clone(d.People), nil
}

func (d *Directory) Get(_ context.Context, resourceName string) (contacts.Person, error) {
	i := d.Find(resourceName)
	if i < 0 {
		return contacts.Person{}, apperr.NotFound("That contact is no longer in Google Contacts.")
	}
	return d.People[i], nil
}

func (d *Directory) Create(_ context.Context, in contacts.Details) (contacts.Person, error) {
	d.beforeWrite("contacts.create")
	d.created++
	p := contacts.Person{ResourceName: fmt.Sprintf("people/c%d", d.created), ETag: "1"}
	p.GivenName, p.FamilyName = in.GivenName, in.FamilyName
	p.DisplayName = strings.TrimSpace(in.GivenName + " " + in.FamilyName)
	apply(&p, in)
	d.People = append(d.People, p)
	return p, nil
}

func (d *Directory) Update(_ context.Context, resourceName, etag string, in contacts.Details) (contacts.Person, error) {
	d.beforeWrite("contacts.update")
	i := d.Find(resourceName)
	if i < 0 {
		return contacts.Person{}, apperr.NotFound("That contact is no longer in Google Contacts.")
	}
	p := &d.People[i]
	if p.ETag != etag {
		return contacts.Person{}, apperr.Conflict("This contact was changed in Google meanwhile. Check the latest details and save again.")
	}
	apply(p, in)
	p.ETag += "+"
	return *p, nil
}

func (d *Directory) Label(context.Context, string) error {
	d.beforeWrite("contacts.label")
	return nil
}

func apply(p *contacts.Person, in contacts.Details) {
	p.Email, p.Phone, p.Address = in.Email, in.Phone, in.Address
}
