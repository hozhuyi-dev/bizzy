package simulation

import (
	"slices"
	"strings"

	"pgregory.net/rapid"

	"bizzy-lambda/internal/features/contacts"
	"bizzy-lambda/internal/features/documents"
	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/platform/statemodel"
)

// userActions are what the user does in the app: one per router mutation,
// with the payload the app sends.
var userActions = []Action{
	// Clients and contacts.
	{Name: "clients.save", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		var c map[string]any
		if rapid.Bool().Draw(t, "new client?") {
			c = map[string]any{"name": rapid.SampledFrom(names).Draw(t, "name")}
		} else {
			existing := w.Store.ClientMap[pickClientID(t, w)]
			c = map[string]any{"id": existing.ID, "name": existing.Name, "aliases": existing.Aliases,
				"defaultFeeCents": existing.DefaultFeeCents, "homeVisits": existing.HomeVisits}
			if existing.Contact != nil {
				c["contact"] = map[string]any{"resourceName": existing.Contact.ResourceName}
			}
			switch rapid.IntRange(0, 3).Draw(t, "edit") {
			case 0:
				c["aliases"] = append(slices.Clone(existing.Aliases), rapid.SampledFrom(names).Draw(t, "alias"))
			case 1:
				c["defaultFeeCents"] = rapid.SampledFrom([]*int64{nil, cents(9000), cents(15000)}).Draw(t, "default fee")
			case 2:
				c["homeVisits"] = !existing.HomeVisits
			}
		}
		if _, ok := c["contact"]; !ok && len(w.Contacts.People) > 0 {
			person := rapid.SampledFrom(w.Contacts.People).Draw(t, "contact")
			c["contact"] = map[string]any{"resourceName": person.ResourceName}
		}
		w.Call(t, "clients.save", c, false)
	}},
	{Name: "clients.markContacted", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		w.Call(t, "clients.markContacted", map[string]any{"id": pickClientID(t, w), "contacted": rapid.Bool().Draw(t, "contacted")}, false)
	}},
	{Name: "contacts.create", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		name := strings.Fields(rapid.SampledFrom(names).Draw(t, "name"))
		w.Call(t, "contacts.create", contacts.Details{GivenName: name[0], FamilyName: strings.Join(name[1:], " "), Phone: "013"}, false)
	}},
	{Name: "contacts.update", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		if len(w.Contacts.People) == 0 {
			t.Skip("no contacts")
		}
		p := rapid.SampledFrom(w.Contacts.People).Draw(t, "contact")
		w.Call(t, "contacts.update", map[string]any{"resourceName": p.ResourceName, "etag": p.ETag,
			"details": contacts.Details{Phone: rapid.SampledFrom([]string{"011", "012"}).Draw(t, "phone"), Address: p.Address}}, false)
	}},

	// Sessions: the booking goes through the calendar, the record and the
	// payment stay here.
	{Name: "sessions.create", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		w.Call(t, "sessions.create", sessionDraft(t, w), false)
	}},
	{Name: "sessions.update", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		s := pickSession(t, w, nil)
		d := sessionDraft(t, w)
		d["eventId"] = s.EventID
		w.Call(t, "sessions.update", d, true)
	}},
	{Name: "sessions.delete", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		w.Call(t, "sessions.delete", map[string]any{"eventId": pickSession(t, w, nil).EventID}, true)
	}},
	{Name: "sessions.restore", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		s := pickSession(t, w, removedOrAny(t))
		w.CallAsViewed(t, "sessions.restore", map[string]any{"eventId": s.EventID}, s.View(w.Now).Can.Restore)
	}},
	{Name: "sessions.discard", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		s := pickSession(t, w, removedOrAny(t))
		w.CallAsViewed(t, "sessions.discard", map[string]any{"eventId": s.EventID}, s.View(w.Now).Can.Discard)
	}},
	{Name: "sessions.saveRecord", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		s := pickSession(t, w, nil)
		in := map[string]any{
			"eventId": s.EventID,
			"summary": rapid.SampledFrom([]string{"", "Knee mobilisation"}).Draw(t, "summary"),
		}
		if rapid.Bool().Draw(t, "notes?") {
			in["notes"] = rapid.SampledFrom([]string{"", "Long notes"}).Draw(t, "notes")
		}
		w.CallAsViewed(t, "sessions.saveRecord", in, s.View(w.Now).Can.Record)
	}},

	// Money.
	{Name: "payments.set", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		var items []map[string]any
		undo := rapid.IntRange(0, 4).Draw(t, "undo?") == 0
		// What the app shows for the first item, when it is the only one.
		var viewed statemodel.Verdict
		if rapid.IntRange(0, 3).Draw(t, "package alone?") == 0 {
			p := pickPackage(t, w, nil)
			items = append(items, map[string]any{"kind": "package", "id": p.ID})
			viewed = p.View(w.Now).Can.Pay
		} else {
			s := pickSession(t, w, nil)
			items = append(items, map[string]any{"kind": "session", "id": s.EventID})
			viewed = s.View(w.Now).Can.Pay
			if undo {
				viewed = s.View(w.Now).Can.UndoPayment
			}
			// The package bought in a session is keyed by its event.
			if _, bought := w.Store.PackageMap[s.EventID]; bought && rapid.Bool().Draw(t, "with its package?") {
				items = append(items, map[string]any{"kind": "package", "id": s.EventID})
			}
		}
		in := map[string]any{"items": items}
		if !undo {
			in["payment"] = paymentInput(t)
		}
		if len(items) > 1 {
			w.Call(t, "payments.set", in, false)
			return
		}
		w.CallAsViewed(t, "payments.set", in, viewed)
	}},
	{Name: "packages.save", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		in := map[string]any{
			"clientId":    pickClientID(t, w),
			"sessions":    rapid.SampledFrom([]int{1, 5, 10}).Draw(t, "sessions"),
			"priceCents":  rapid.SampledFrom([]int64{0, 40000, 85000}).Draw(t, "price"),
			"purchasedAt": when(t, w),
		}
		if rapid.Bool().Draw(t, "edit?") {
			in["id"] = pickPackage(t, w, nil).ID
		}
		if rapid.Bool().Draw(t, "paid now?") {
			in["paid"] = paymentInput(t)
		}
		w.Call(t, "packages.save", in, false)
	}},
	{Name: "packages.delete", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		p := pickPackage(t, w, nil)
		w.CallAsViewed(t, "packages.delete", map[string]any{"id": p.ID}, p.View(w.Now).Can.Delete)
	}},

	// Documents.
	{Name: "documents.createDraft", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		docType := rapid.SampledFrom([]documents.Type{documents.TypeInvoice, documents.TypeReceipt}).Draw(t, "type")
		var sources []documents.Source
		switch rapid.IntRange(0, 3).Draw(t, "covers") {
		case 0:
			sources = append(sources, documents.Source{Kind: documents.SourcePackage, ID: pickPackage(t, w, nil).ID})
		case 1:
			// Two sessions, for one invoice over a month.
			a := pickSession(t, w, nil)
			b := pickSession(t, w, func(s sessions.Session) bool { return s.EventID != a.EventID })
			sources = append(sources, sessionSource(a.EventID), sessionSource(b.EventID))
		default:
			s := pickSession(t, w, nil)
			sources = append(sources, sessionSource(s.EventID))
			if _, bought := w.Store.PackageMap[s.EventID]; bought && rapid.Bool().Draw(t, "with its package?") {
				sources = append(sources, documents.Source{Kind: documents.SourcePackage, ID: s.EventID})
			}
		}
		w.Call(t, "documents.createDraft", map[string]any{"type": docType, "sources": sources}, false)
	}},
	{Name: "documents.saveDraft", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		d := pickDocument(t, w, func(d documents.Document) bool { return d.Draft != nil })
		content := *d.Draft
		content.Lines = slices.Clone(content.Lines)
		switch rapid.IntRange(0, 2).Draw(t, "edit") {
		case 0:
			if len(content.Lines) > 1 {
				i := rapid.IntRange(0, len(content.Lines)-1).Draw(t, "line to drop")
				content.Lines = slices.Delete(content.Lines, i, i+1)
			}
		case 1:
			i := rapid.IntRange(0, len(content.Lines)-1).Draw(t, "line to reprice")
			content.Lines[i].AmountCents = rapid.SampledFrom([]int64{0, 5000, 9500}).Draw(t, "amount")
		default:
			content.Notes = "Thank you"
		}
		w.Call(t, "documents.saveDraft", map[string]any{"id": d.ID, "version": d.Version, "content": content}, false)
	}},
	{Name: "documents.issue", Actor: ActorUser, Run: docStep("documents.issue", func(d documents.Document) bool { return d.Draft != nil })},
	{Name: "documents.revise", Actor: ActorUser, Run: docStep("documents.revise", func(d documents.Document) bool {
		return d.Status == documents.StatusIssued && d.Draft == nil
	})},
	{Name: "documents.discardDraft", Actor: ActorUser, Run: docStep("documents.discardDraft", func(d documents.Document) bool { return d.Draft != nil })},
	{Name: "documents.cancel", Actor: ActorUser, Run: docStep("documents.cancel", func(d documents.Document) bool { return d.Status == documents.StatusIssued })},
	{Name: "documents.resetShare", Actor: ActorUser, Run: docStep("documents.resetShare", func(d documents.Document) bool { return d.Status == documents.StatusIssued })},
	{Name: "documents.share", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		w.Call(t, "documents.share", map[string]any{"ids": []string{pickDocument(t, w, nil).ID}}, false)
	}},

	// Follow-ups.
	{Name: "followUps.create", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		in := followUpDraft(t, w)
		if rapid.Bool().Draw(t, "from a session?") {
			in["sessionId"] = pickSession(t, w, nil).EventID
		}
		w.Call(t, "followUps.create", in, false)
	}},
	{Name: "followUps.update", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		in := followUpDraft(t, w)
		in["eventId"] = pickFollowUp(t, w, nil).EventID
		w.Call(t, "followUps.update", in, true)
	}},
	{Name: "followUps.delete", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		w.Call(t, "followUps.delete", map[string]any{"eventId": pickFollowUp(t, w, nil).EventID}, false)
	}},
	{Name: "followUps.setDone", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		f := pickFollowUp(t, w, nil)
		w.Call(t, "followUps.setDone", map[string]any{"eventId": f.EventID, "done": f.DoneAt == nil}, false)
	}},

	// Settings and the sync.
	{Name: "settings.save", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		cfg := w.Store.SettingsVal
		cfg.HomeVisitColorID = rapid.SampledFrom([]string{"", "5", "11"}).Draw(t, "home visit colour")
		w.Call(t, "settings.save", cfg, false)
	}},
	{Name: "sync.run", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		if _, err := w.Call(t, "sync.run", map[string]any{"all": true}, false); err == nil {
			w.InSync = true
		}
	}},
}

// removedOrAny mostly picks a session deleted from the calendar, which
// restore and discard are for, and sometimes any session.
func removedOrAny(t *rapid.T) func(sessions.Session) bool {
	if rapid.IntRange(0, 4).Draw(t, "any session?") == 0 {
		return nil
	}
	return func(s sessions.Session) bool { return s.RemovedAt != nil }
}

func sessionSource(id string) documents.Source {
	return documents.Source{Kind: documents.SourceSession, ID: id}
}

// docStep calls an action that takes a document and the version the user
// last saw: usually the current one, sometimes a stale tab's.
func docStep(action string, keep func(documents.Document) bool) func(t *rapid.T, w *World) {
	return func(t *rapid.T, w *World) {
		d := pickDocument(t, w, keep)
		version := d.Version
		if rapid.IntRange(0, 9).Draw(t, "stale tab?") == 0 {
			version--
		}
		w.Call(t, action, map[string]any{"id": d.ID, "version": version, "reason": "Wrong amount"}, false)
	}
}

func followUpDraft(t *rapid.T, w *World) map[string]any {
	in := map[string]any{
		"clientId": pickClientID(t, w),
		"summary":  rapid.SampledFrom([]string{"", "Check in"}).Draw(t, "summary"),
		"notes":    "",
	}
	at := when(t, w)
	if rapid.Bool().Draw(t, "all day?") {
		in["date"] = at.In(kl).Format("2006-01-02")
	} else {
		in["start"] = at
	}
	return in
}
