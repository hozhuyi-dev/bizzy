package simulation

import (
	"encoding/json"
	"maps"
	"slices"
	"strings"
	"time"

	"pgregory.net/rapid"

	"bizzy-lambda/internal/features/attachments"
	"bizzy-lambda/internal/features/contacts"
	"bizzy-lambda/internal/features/documents"
	"bizzy-lambda/internal/features/expenses"
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
			c = profileOf(w.Store.ClientMap[pickClientID(t, w)])
			switch rapid.IntRange(0, 3).Draw(t, "edit") {
			case 0:
				c["aliases"] = append(slices.Clone(c["aliases"].([]string)), rapid.SampledFrom(names).Draw(t, "alias"))
			case 1:
				c["feeRates"] = rapid.SampledFrom(feeRateChoices).Draw(t, "fees")
			case 2:
				c["homeVisits"] = !c["homeVisits"].(bool)
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

	// Sessions: the booking, what pays for it, and the record.
	{Name: "sessions.create", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		w.Call(t, "sessions.create", sessionDraft(t, w), true)
	}},
	{Name: "sessions.update", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		s := pickSession(t, w, nil)
		d := sessionDraft(t, w)
		d["id"] = s.ID
		if rapid.Bool().Draw(t, "keep the client?") {
			d["clientId"] = s.ClientID
		}
		if s.Paid != nil {
			d["updatePayment"] = rapid.Bool().Draw(t, "update the payment?")
		}
		w.Call(t, "sessions.update", d, true)
	}},
	{Name: "sessions.delete", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		s := pickSession(t, w, nil)
		keep := s.BoughtPackageID == "" || rapid.Bool().Draw(t, "keep its package?")
		viewed := w.sessionCan(t, s).Delete
		stale := !w.InSync
		_, refused := w.Call(t, "sessions.delete", map[string]any{"id": s.ID, "keepPackage": keep}, true)
		if keep {
			w.asViewed(t, "sessions.delete", refused, viewed, stale)
		}
	}},
	{Name: "sessions.saveRecord", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		s := pickSession(t, w, nil)
		in := map[string]any{
			"id":      s.ID,
			"summary": rapid.SampledFrom([]string{"", "Knee mobilisation"}).Draw(t, "summary"),
		}
		if rapid.Bool().Draw(t, "notes?") {
			in["notes"] = rapid.SampledFrom([]string{"", "Long notes"}).Draw(t, "notes")
		}
		w.CallAsViewed(t, "sessions.saveRecord", in, s.View(w.Now, sessions.Can{}).Can.Record)
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
			viewed = s.View(w.Now, sessions.Can{}).Can.Attach
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
			can := w.packageCan(t, p)
			viewed = can.Pay
			if undo {
				viewed = can.UndoPayment
			}
		} else {
			s := pickSession(t, w, nil)
			items = append(items, map[string]any{"kind": "session", "id": s.ID})
			can := w.sessionCan(t, s)
			viewed = can.Pay
			if undo {
				viewed = can.UndoPayment
			}
			if s.BoughtPackageID != "" && rapid.Bool().Draw(t, "with its package?") {
				items = append(items, map[string]any{"kind": "package", "id": s.BoughtPackageID})
			}
		}
		in := map[string]any{"items": items}
		if !undo {
			in["payment"] = paymentInput(t)
		}
		stale := !w.InSync
		_, refused := w.Call(t, "payments.set", in, true)
		if len(items) == 1 {
			w.asViewed(t, "payments.set", refused, viewed, stale)
		}
	}},
	{Name: "packages.save", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		in := map[string]any{
			"clientId":    pickClientID(t, w),
			"sessions":    rapid.SampledFrom([]int{1, 2, 5}).Draw(t, "sessions"),
			"priceCents":  rapid.SampledFrom([]int64{0, 40000, 85000}).Draw(t, "price"),
			"purchasedAt": when(t, w),
		}
		if len(w.Store.PackageMap) > 0 && rapid.Bool().Draw(t, "edit?") {
			p := pickPackage(t, w, nil)
			in["id"] = p.ID
			if rapid.Bool().Draw(t, "as the form has it?") {
				// The form starts from the package: only what she changes
				// differs.
				in["clientId"], in["purchasedAt"], in["sessions"] = p.ClientID, p.PurchasedAt, p.Sessions
			}
			in["updatePayment"] = rapid.Bool().Draw(t, "update the payment?")
		}
		if rapid.Bool().Draw(t, "paid now?") {
			in["paid"] = paymentInput(t)
		}
		w.Call(t, "packages.save", in, true)
	}},
	{Name: "packages.delete", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		p := pickPackage(t, w, nil)
		viewed := w.packageCan(t, p).Delete
		stale := !w.InSync
		_, refused := w.Call(t, "packages.delete", map[string]any{"id": p.ID}, true)
		w.asViewed(t, "packages.delete", refused, viewed, stale)
	}},
	{Name: "packages.makeStandalone", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		p := pickPackage(t, w, nil)
		viewed := w.packageCan(t, p).MakeStandalone
		stale := !w.InSync
		_, refused := w.Call(t, "packages.makeStandalone", map[string]any{"id": p.ID}, true)
		w.asViewed(t, "packages.makeStandalone", refused, viewed, stale)
	}},

	// Documents: drafts made with what they cover, issued when she wants.
	{Name: "documents.saveDraft", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		d := pickDocument(t, w, func(d documents.Document) bool { return d.Draft != nil })
		content := *d.Draft
		content.Lines = slices.Clone(content.Lines)
		switch rapid.IntRange(0, 4).Draw(t, "edit") {
		case 0:
			i := rapid.IntRange(0, len(content.Lines)-1).Draw(t, "line to drop")
			content.Lines = slices.Delete(content.Lines, i, i+1)
		case 1:
			i := rapid.IntRange(0, len(content.Lines)-1).Draw(t, "line to reprice")
			content.Lines[i].AmountCents = rapid.SampledFrom([]int64{0, 5000, 9500}).Draw(t, "amount")
		case 2:
			content.Lines = append(content.Lines, documents.Line{Description: "Kinesio tape", AmountCents: 1500})
		case 3:
			content.Recipient.Name = "Jane Smyth"
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
	{Name: "documents.moveLines", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		from := pickDocument(t, w, func(d documents.Document) bool { return d.Status == documents.StatusDraft })
		line := rapid.SampledFrom(from.Draft.Lines).Draw(t, "line")
		to := ""
		if rapid.Bool().Draw(t, "onto another draft?") {
			to = pickDocument(t, w, func(d documents.Document) bool { return d.ID != from.ID }).ID
		}
		w.Call(t, "documents.moveLines", map[string]any{"from": from.ID, "to": to, "lineIds": []string{line.ID}}, false)
	}},

	// Follow-ups.
	{Name: "followUps.create", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		in := followUpDraft(t, w)
		if len(w.Store.SessionMap) > 0 && rapid.Bool().Draw(t, "from a session?") {
			in["sessionId"] = pickSession(t, w, nil).ID
		}
		w.Call(t, "followUps.create", in, false)
	}},
	{Name: "followUps.update", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		in := followUpDraft(t, w)
		in["id"] = pickFollowUp(t, w, nil).ID
		w.Call(t, "followUps.update", in, false)
	}},
	{Name: "followUps.delete", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		w.Call(t, "followUps.delete", map[string]any{"id": pickFollowUp(t, w, nil).ID}, false)
	}},
	{Name: "followUps.setDone", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		f := pickFollowUp(t, w, nil)
		w.Call(t, "followUps.setDone", map[string]any{"id": f.ID, "done": f.DoneAt == nil}, false)
	}},

	// What she does about an edit made in the calendar that wasn't applied.
	{Name: "calendar.revert", Actor: ActorUser, Run: conflictStep("calendar.revert")},
	{Name: "conflicts.apply", Actor: ActorUser, Run: conflictStep("conflicts.apply")},
	{Name: "calendar.ignore", Actor: ActorUser, Run: conflictStep("calendar.ignore")},

	// Settings and the sync.
	{Name: "settings.save", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		cfg := w.Store.SettingsVal
		cfg.ServiceName = rapid.SampledFrom([]string{"", "Physiotherapy", "Physio session"}).Draw(t, "service name")
		w.Call(t, "settings.save", cfg, false)
	}},
	{Name: "sync.run", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		if _, err := w.Call(t, "sync.run", map[string]any{"all": true}, false); err == nil {
			w.InSync = true
		}
	}},
}

// conflictStep calls an action on a conflict, as its to-do item does.
func conflictStep(action string) func(t *rapid.T, w *World) {
	return func(t *rapid.T, w *World) {
		c := w.Store.ConflictMap[pick(t, "conflict", w.Store.ConflictMap, nil)]
		w.Call(t, action, map[string]any{"key": c.Key}, true)
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
	return attachments.OwnerSession, s.ID, s.View(w.Now, sessions.Can{}).Can.Attach
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
		"summary":  rapid.SampledFrom([]string{"", "Check in", "  call:  back "}).Draw(t, "summary"),
		"notes":    rapid.SampledFrom([]string{"", "Ask about the knee"}).Draw(t, "notes"),
	}
	at := when(t, w)
	if rapid.Bool().Draw(t, "all day?") {
		in["date"] = at.In(kl).Format("2006-01-02")
	} else {
		in["start"] = at
	}
	return in
}
