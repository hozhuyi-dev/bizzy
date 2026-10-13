package simulation

import (
	"slices"

	"pgregory.net/rapid"
)

// contactsActions are edits made in Google Contacts itself.
var contactsActions = []Action{
	{Name: "contacts.externalEdit", Actor: ActorContacts, Run: func(t *rapid.T, w *World) {
		if len(w.Contacts.People) == 0 {
			t.Skip("no contacts")
		}
		p := &w.Contacts.People[rapid.IntRange(0, len(w.Contacts.People)-1).Draw(t, "contact")]
		p.Phone = rapid.SampledFrom([]string{"016", "017"}).Draw(t, "phone")
		p.ETag += "+"
		t.Logf("contacts: edited %s", p.ResourceName)
		outsideChange(w)
	}},
	{Name: "contacts.externalDelete", Actor: ActorContacts, Run: func(t *rapid.T, w *World) {
		if len(w.Contacts.People) == 0 {
			t.Skip("no contacts")
		}
		i := rapid.IntRange(0, len(w.Contacts.People)-1).Draw(t, "contact")
		t.Logf("contacts: deleted %s", w.Contacts.People[i].ResourceName)
		w.Contacts.People = slices.Delete(w.Contacts.People, i, i+1)
		outsideChange(w)
	}},
}
