package simulation

import (
	"encoding/json"
	"fmt"
	"maps"
	"slices"
	"strings"
	"time"

	"pgregory.net/rapid"

	"bizzy-lambda/internal/features/attachments"
	"bizzy-lambda/internal/features/billing"
	"bizzy-lambda/internal/features/clients"
	"bizzy-lambda/internal/features/contacts"
	"bizzy-lambda/internal/features/documents"
	"bizzy-lambda/internal/features/expenses"
	"bizzy-lambda/internal/features/packages"
	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/platform/statemodel"
	"bizzy-lambda/internal/router"
)

// userActions are what the user does in the app: one per router mutation,
// with the payload the app sends.
var userActions = []Action{
	// Clients and contacts.
	{Name: "clients.save", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		var c map[string]any
		feesOnly := false
		if rapid.Bool().Draw(t, "new client?") {
			c = map[string]any{"name": rapid.SampledFrom(names).Draw(t, "name")}
		} else {
			existing := w.Store.ClientMap[pickClientID(t, w)]
			c = map[string]any{"id": existing.ID, "name": existing.Name, "aliases": existing.Aliases,
				"feeRates": existing.FeeRates, "homeVisits": existing.HomeVisits}
			if existing.Contact != nil {
				c["contact"] = map[string]any{"resourceName": existing.Contact.ResourceName}
			}
			switch rapid.IntRange(0, 3).Draw(t, "edit") {
			case 0:
				c["aliases"] = append(slices.Clone(existing.Aliases), rapid.SampledFrom(names).Draw(t, "alias"))
			case 1:
				c["feeRates"] = rapid.SampledFrom(feeRateChoices).Draw(t, "fees")
				feesOnly = true
			case 2:
				c["homeVisits"] = !existing.HomeVisits
			}
		}
		if _, ok := c["contact"]; !ok && len(w.Contacts.People) > 0 {
			person := rapid.SampledFrom(w.Contacts.People).Draw(t, "contact")
			c["contact"] = map[string]any{"resourceName": person.ResourceName}
		}
		confirm := confirms(t)
		if !feesOnly || !w.InSync {
			w.Previewed(t, "clients.impact", c, "clients.save", c, confirm, false)
			return
		}
		// What the form shows before saving new fees must be exactly what
		// saving reprices.
		data, refused := w.Call(t, "billing.feeImpact", map[string]any{"clientId": c["id"], "feeRates": c["feeRates"]}, false)
		before := fees(w)
		if _, err := w.Previewed(t, "clients.impact", c, "clients.save", c, confirm, false); err != nil || refused != nil {
			return
		}
		var impact billing.FeeImpact
		if err := json.Unmarshal(data, &impact); err != nil {
			t.Fatalf("feeImpact result: %v", err)
		}
		predicted := map[string]bool{}
		for _, ch := range impact.Changes {
			predicted[ch.EventID] = true
		}
		after := fees(w)
		for id, fee := range after {
			if changed := before[id] != fee; changed != predicted[id] {
				t.Fatalf("session %s: fee %s → %s, but feeImpact predicted a change: %v", id, before[id], fee, predicted[id])
			}
		}
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
		d := sessionDraft(t, w)
		w.Previewed(t, "sessions.impact", d, "sessions.create", d, confirms(t), false)
	}},
	{Name: "sessions.update", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		s := pickSession(t, w, nil)
		d := sessionDraft(t, w)
		d["eventId"] = s.EventID
		if s.Payment.IsPaid() {
			d["updatePayment"] = rapid.Bool().Draw(t, "update the payment?")
		}
		w.Previewed(t, "sessions.impact", d, "sessions.update", d, confirms(t), true)
	}},
	{Name: "sessions.delete", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		s := pickSession(t, w, nil)
		stale := !w.InSync
		refused := deleteSession(t, w, s.EventID)
		asViewed(t, "sessions.delete", refused, s.View(w.Now).Can.Delete, stale)
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

	// Files: the app asks for an upload, the browser uploads (or the tab is
	// closed first), then the app confirms.
	{Name: "attachments.confirm", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		kind, ownerID, viewed := pickOwner(t, w)
		file := rapid.SampledFrom(attachmentChoices).Draw(t, "file")
		owner := map[string]any{"ownerKind": kind, "ownerId": ownerID}
		data, refused := w.Call(t, "attachments.requestUpload", with(owner, map[string]any{
			"name": file.name, "contentType": file.contentType, "sizeBytes": file.size,
		}), false)
		id := "never-requested"
		if refused == nil {
			var ticket attachments.Ticket
			if err := json.Unmarshal(data, &ticket); err != nil {
				t.Fatalf("requestUpload result: %v", err)
			}
			id = ticket.ID
			if rapid.IntRange(0, 5).Draw(t, "tab closed before uploading?") > 0 {
				if err := w.Blobs.Put(attachments.KeyOf(kind, ownerID, id, file.contentType)); err != nil {
					t.Fatalf("upload: %v", err)
				}
			}
		}
		w.CallAsViewed(t, "attachments.confirm", with(owner, map[string]any{
			"id": id, "name": file.name, "contentType": file.contentType,
		}), viewed)
	}},
	{Name: "attachments.delete", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		a := w.Store.AttachmentMap[pick(t, "attachment", w.Store.AttachmentMap, nil)]
		// An expense's files can always change.
		viewed := statemodel.Verdict{OK: true}
		if s, ok := w.Store.SessionMap[a.OwnerID]; ok && a.OwnerKind == attachments.OwnerSession {
			viewed = s.View(w.Now).Can.Attach
		}
		w.CallAsViewed(t, "attachments.delete", map[string]any{"ownerKind": a.OwnerKind, "ownerId": a.OwnerID, "id": a.ID}, viewed)
	}},

	// Expenses: a receipt's lines name items from the list, or new ones.
	{Name: "expenses.save", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		in := map[string]any{
			"date":   w.Now.In(kl).AddDate(0, 0, -rapid.IntRange(0, 40).Draw(t, "days ago")).Format(time.DateOnly),
			"vendor": rapid.SampledFrom([]string{"", "Shopee", "Guardian"}).Draw(t, "vendor"),
		}
		if len(w.Store.ExpenseMap) > 0 && rapid.Bool().Draw(t, "edit?") {
			e := w.Store.ExpenseMap[pick(t, "expense", w.Store.ExpenseMap, nil)]
			in["id"], in["version"] = e.ID, e.Version
			if rapid.IntRange(0, 9).Draw(t, "stale tab?") == 0 {
				in["version"] = e.Version - 1
			}
		}
		var lines []map[string]any
		for range rapid.IntRange(0, 3).Draw(t, "lines") {
			amount := rapid.SampledFrom([]int64{0, 1250, 8900}).Draw(t, "amount")
			if len(w.Store.ItemMap) > 0 && rapid.Bool().Draw(t, "listed item?") {
				it := w.Store.ItemMap[pick(t, "item", w.Store.ItemMap, nil)]
				lines = append(lines, map[string]any{"itemId": it.ID, "name": it.Name, "categoryId": it.CategoryID, "amountCents": amount})
				continue
			}
			lines = append(lines, map[string]any{
				"name":        rapid.SampledFrom(itemNames).Draw(t, "new item"),
				"categoryId":  rapid.SampledFrom(categoryIDs(w, "bogus")).Draw(t, "category"),
				"amountCents": amount,
			})
		}
		in["lines"] = lines
		w.Call(t, "expenses.save", in, false)
	}},
	{Name: "expenses.delete", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		e := w.Store.ExpenseMap[pick(t, "expense", w.Store.ExpenseMap, nil)]
		version := e.Version
		if rapid.IntRange(0, 9).Draw(t, "stale tab?") == 0 {
			version--
		}
		w.Call(t, "expenses.delete", map[string]any{"id": e.ID, "version": version}, false)
	}},
	{Name: "expenses.saveItem", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		it := w.Store.ItemMap[pick(t, "item", w.Store.ItemMap, nil)]
		w.Call(t, "expenses.saveItem", map[string]any{
			"id":         it.ID,
			"name":       rapid.SampledFrom(append([]string{it.Name}, itemNames...)).Draw(t, "name"),
			"categoryId": rapid.SampledFrom(categoryIDs(w, "bogus")).Draw(t, "category"),
			"archived":   rapid.Bool().Draw(t, "archived"),
		}, false)
	}},
	{Name: "expenses.saveCategories", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		all := w.Store.CategoryList
		if all == nil {
			all = expenses.DefaultCategories
		}
		all = slices.Clone(all)
		i := rapid.IntRange(0, len(all)-1).Draw(t, "category")
		switch rapid.IntRange(0, 4).Draw(t, "edit") {
		case 0:
			all[i].Name = "Fuel and tolls"
		case 1:
			all = append(all, expenses.Category{Name: rapid.SampledFrom([]string{"Courses", "Other expenses"}).Draw(t, "new")})
		case 2:
			all[i].Archived = !all[i].Archived
		case 3:
			// Deleting one is refused: archive it instead.
			all = slices.Delete(all, i, i+1)
		default:
			slices.Reverse(all)
		}
		w.Call(t, "expenses.saveCategories", map[string]any{"categories": all}, false)
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
			w.Call(t, "payments.set", in, true)
			return
		}
		stale := !w.InSync
		_, refused := w.Call(t, "payments.set", in, true)
		asViewed(t, "payments.set", refused, viewed, stale)
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
		if _, editing := in["id"]; editing {
			in["updatePayment"] = rapid.Bool().Draw(t, "update the payment?")
		}
		withClientFee(t, in)
		w.Previewed(t, "packages.impact", in, "packages.save", in, confirms(t), true)
	}},
	{Name: "packages.delete", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		p := pickPackage(t, w, nil)
		in := map[string]any{"id": p.ID}
		withClientFee(t, in)
		stale := !w.InSync
		_, refused := w.Previewed(t, "packages.impact", with(in, map[string]any{"delete": true}), "packages.delete", in, confirms(t), true)
		asViewed(t, "packages.delete", refused, p.View(w.Now).Can.Delete, stale)
	}},
	{Name: "packages.makeStandalone", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		p := pickPackage(t, w, nil)
		stale := !w.InSync
		_, refused := w.Call(t, "packages.makeStandalone", map[string]any{"id": p.ID}, true)
		asViewed(t, "packages.makeStandalone", refused, p.View(w.Now).Can.MakeStandalone, stale)
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
	// Reopening shows again what its title says.
	{Name: "followUps.setDone", Actor: ActorUser, Reveals: true, Run: func(t *rapid.T, w *World) {
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

// deleteSession deletes a session as the dialog does: it asks what happens
// to the package it bought, if any, and shows what that brings on first.
func deleteSession(t *rapid.T, w *World, eventID string) *router.ErrorBody {
	in := map[string]any{"eventId": eventID}
	if p, ok := w.Store.PackageMap[eventID]; ok && p.Source == packages.SourceCalendar {
		in["package"] = rapid.SampledFrom([]string{"keep", "delete"}).Draw(t, "its package")
	}
	if _, chose := in["package"]; chose {
		_, refused := w.Previewed(t, "sessions.deleteImpact", in, "sessions.delete", in, confirms(t), true)
		return refused
	}
	_, refused := w.Call(t, "sessions.delete", in, true)
	return refused
}

// withClientFee sometimes gives the package's client a usual fee in the
// same save, as the form offers when the change leaves sessions without
// one.
func withClientFee(t *rapid.T, in map[string]any) {
	if rapid.IntRange(0, 3).Draw(t, "give the client a usual fee?") == 0 {
		in["clientFeeCents"] = rapid.SampledFrom([]int64{9000, 15000}).Draw(t, "usual fee")
	}
}

// itemNames are things she buys, one of them typed differently.
var itemNames = []string{"Kinesio tape", "Ultrasound gel", "Parking", "kinesio  TAPE"}

// categoryIDs are the categories' ids, and some that aren't.
func categoryIDs(w *World, others ...string) []string {
	all := w.Store.CategoryList
	if all == nil {
		all = expenses.DefaultCategories
	}
	ids := slices.Clone(others)
	for _, c := range all {
		ids = append(ids, c.ID)
	}
	return ids
}

// pickOwner draws a session or an expense to attach a file to, with what
// its view says about attaching.
func pickOwner(t *rapid.T, w *World) (attachments.OwnerKind, string, statemodel.Verdict) {
	if len(w.Store.ExpenseMap) > 0 && rapid.Bool().Draw(t, "an expense's receipt?") {
		return attachments.OwnerExpense, pick(t, "expense", w.Store.ExpenseMap, nil), statemodel.Verdict{OK: true}
	}
	s := pickSession(t, w, nil)
	return attachments.OwnerSession, s.EventID, s.View(w.Now).Can.Attach
}

// attachmentChoices are files the app can be given: a photo, a PDF, and two
// it must turn away.
var attachmentChoices = []struct {
	name, contentType string
	size              int64
}{
	{"knee.jpg", "image/jpeg", 300_000},
	{"MRI report.pdf", "application/pdf", 2_000_000},
	{"scan.tiff", "image/tiff", 1_000},
	{"video.jpg", "image/jpeg", 50 << 20},
}

// with is a copy of a payload with more fields.
func with(base, more map[string]any) map[string]any {
	out := maps.Clone(base)
	maps.Copy(out, more)
	return out
}

// feeRateChoices are fees the form can save: none, one, or one raised
// around the time the clock starts (the day before, or two days after).
var feeRateChoices = [][]clients.FeeRate{
	nil,
	{{Cents: 9000}},
	{{Cents: 15000}},
	{{Cents: 9000}, {From: "2026-10-12", Cents: 10000}},
	{{Cents: 9000}, {From: "2026-10-15", Cents: 10000}},
}

// fees is what each session is charged, to compare before and after.
func fees(w *World) map[string]string {
	out := map[string]string{}
	for id, s := range w.Store.SessionMap {
		out[id] = fmt.Sprintf("%s %d", s.Status, s.DueCents())
	}
	return out
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
		w.Call(t, action, map[string]any{"id": d.ID, "version": version, "reason": "Wrong amount"}, action == "documents.issue")
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
