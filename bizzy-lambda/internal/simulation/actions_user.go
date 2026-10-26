package simulation

import (
	"encoding/json"
	"slices"
	"strings"
	"time"

	"pgregory.net/rapid"

	"bizzy-lambda/internal/features/attachments"
	"bizzy-lambda/internal/features/clients"
	"bizzy-lambda/internal/features/conflicts"
	"bizzy-lambda/internal/features/documents"
	"bizzy-lambda/internal/features/expenses"
	"bizzy-lambda/internal/features/followups"
	"bizzy-lambda/internal/features/packages"
	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/platform/txn"
)

// names are what the user calls clients, some already taken or not
// writable in a title.
var names = []string{"Jane Smith", "jane  smith", "Bob Lee", "Amy Tan", "Zed Ong", "Kim Lee", "Jane S", "Kid 2"}

// userActions are what the user does in the app: one per router mutation,
// with the payload the app sends.
var userActions = slices.Concat(clientActions, sessionActions, moneyActions, followUpActions, fileActions, syncActions)

var clientActions = []Action{
	{Name: "clients.create", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		name := rapid.SampledFrom(names).Draw(t, "name")
		in := map[string]any{"name": name, "contact": map[string]any{"resourceName": w.Contact(name)}}
		if rapid.Bool().Draw(t, "usual fee?") {
			in["fee"] = rapid.SampledFrom(fees).Draw(t, "fee")
		}
		w.call(t, "clients.create", in)
	}},
	{Name: "clients.update", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		c := pick(t, w, "client", clients.Clients.All)
		in := map[string]any{"id": c.ID}
		switch rapid.IntRange(0, 5).Draw(t, "edit") {
		case 0:
			in["name"] = rapid.SampledFrom(names).Draw(t, "name")
		case 1:
			in["aliases"] = []string{rapid.SampledFrom(names).Draw(t, "alias")}
		case 2:
			in["fee"] = rapid.SampledFrom(fees).Draw(t, "fee")
		case 3:
			in["homeVisits"] = !c.HomeVisits
		case 4:
			in["contact"] = map[string]any{"resourceName": w.Contact(c.Name)}
		case 5:
			in["contact"] = map[string]any{"resourceName": ""}
		}
		w.call(t, "clients.update", in)
	}},
	{Name: "clients.archive", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		c := clientView(t, w)
		w.callAsViewed(t, "clients.archive", map[string]any{"id": c.ID}, c.Can.Archive)
	}},
	{Name: "clients.unarchive", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		c := clientView(t, w)
		w.callAsViewed(t, "clients.unarchive", map[string]any{"id": c.ID}, c.Can.Unarchive)
	}},
	{Name: "clients.delete", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		c := clientView(t, w)
		w.callAsViewed(t, "clients.delete", map[string]any{"id": c.ID}, c.Can.Delete)
	}},
	{Name: "contacts.create", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		given, family, _ := strings.Cut(rapid.SampledFrom(names).Draw(t, "name"), " ")
		w.call(t, "contacts.create", map[string]any{"givenName": given, "familyName": family, "phone": "013"})
	}},
	{Name: "contacts.update", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		if len(w.Contacts.People) == 0 {
			t.Skip("no contacts")
		}
		p := rapid.SampledFrom(w.Contacts.People).Draw(t, "contact")
		etag := p.ETag
		if rapid.IntRange(0, 4).Draw(t, "stale?") == 0 {
			etag = "0"
		}
		w.call(t, "contacts.update", map[string]any{"resourceName": p.ResourceName, "etag": etag,
			"details": map[string]any{"phone": rapid.SampledFrom([]string{"011", "012"}).Draw(t, "phone"), "email": "x@example.com"}})
	}},
	{Name: "settings.save", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		w.call(t, "settings.save", map[string]any{
			"businessName":      "Physio Co",
			"phone":             rapid.SampledFrom([]string{"", "012-345 6789"}).Draw(t, "phone"),
			"bankName":          "Maybank",
			"accountName":       "Physio Co",
			"accountNo":         rapid.SampledFrom([]string{"", "5140 1234 5678"}).Draw(t, "account no"),
			"duitNowQr":         rapid.SampledFrom([]string{"", duitNowQR, "not a QR"}).Draw(t, "duitnow qr"),
			"payPhone":          rapid.SampledFrom([]string{"", "011-2345 6789", "0123"}).Draw(t, "pay phone"),
			"payApps":           rapid.SampledFrom([][]string{nil, {"tng"}, {"grabpay", "duitnow", "grabpay"}, {"boost"}}).Draw(t, "pay apps"),
			"serviceName":       rapid.SampledFrom([]string{"", "Physiotherapy", "Physio session"}).Draw(t, "service"),
			"confirmAheadDays":  rapid.SampledFrom([]int{0, 1, 3, 40}).Draw(t, "confirm ahead"),
			"followUpAheadDays": rapid.SampledFrom([]int{0, 7}).Draw(t, "follow-up ahead"),
		})
	}},
}

// duitNowQR is a static DuitNow QR as a bank app gives one (made up).
const duitNowQR = "00020101021126490014A000000615000101068900530210000012345605030005204809953034585802MY5909PHYSIO CO6012KUALA LUMPUR6304319E"

var fees = []map[string]any{
	{}, {"cents": 9000}, {"cents": 9500}, {"cents": 1}, {"cents": -1},
}

var sessionActions = []Action{
	{Name: "sessions.create", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		in := map[string]any{"clientId": clientID(t, w), "time": span(t, w)}
		addSessionFields(t, in, true)
		w.call(t, "sessions.create", in)
	}},
	{Name: "sessions.update", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		s := pick(t, w, "session", sessions.Sessions.All)
		in := map[string]any{"id": s.ID}
		if rapid.IntRange(0, 4).Draw(t, "change the client?") == 0 {
			in["clientId"] = clientID(t, w)
		}
		if rapid.Bool().Draw(t, "move it?") {
			in["time"] = span(t, w)
		}
		addSessionFields(t, in, false)
		v := sessionView(t, w, s)
		if !v.Can.Update.OK {
			w.callAsViewed(t, "sessions.update", in, v.Can.Update)
			return
		}
		locked := read(t, w, func(tx *txn.Tx) (apperr.Locks, error) { return sessions.Locks(tx, s) })
		w.callAsLocked(t, "sessions.update", in, locked, sessions.Fields{}, sessionChanges(v, in)...)
	}},
	{Name: "sessions.cancel", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		s := pick(t, w, "session", sessions.Sessions.All)
		reason := rapid.SampledFrom([]string{"", "No-show", "Sick"}).Draw(t, "reason")
		w.callAsViewed(t, "sessions.cancel", map[string]any{"id": s.ID, "reason": reason}, sessionView(t, w, s).Can.Cancel)
	}},
	{Name: "sessions.delete", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		s := pick(t, w, "session", sessions.Sessions.All)
		v := sessionView(t, w, s)
		viewed := v.Can.Delete
		keep := rapid.Bool().Draw(t, "keep its package?")
		if v.Bought != nil && !keep {
			viewed = v.Can.DeleteWithPackage
		}
		w.callAsViewed(t, "sessions.delete", map[string]any{"id": s.ID, "keepPackage": keep}, viewed)
	}},
	{Name: "sessions.saveRecord", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		s := pick(t, w, "session", sessions.Sessions.All)
		in := map[string]any{"id": s.ID, "summary": rapid.SampledFrom([]string{"", "Knee, better"}).Draw(t, "summary")}
		if rapid.Bool().Draw(t, "notes?") {
			in["notes"] = rapid.SampledFrom([]string{"", "Long notes"}).Draw(t, "notes")
		}
		w.callAsViewed(t, "sessions.saveRecord", in, sessionView(t, w, s).Can.Record)
	}},
}

// addSessionFields draws what else a booking form sets.
func addSessionFields(t *rapid.T, in map[string]any, isNew bool) {
	if rapid.IntRange(0, 3).Draw(t, "tentative?") == 0 {
		in["tentative"] = rapid.Bool().Draw(t, "tentative")
	}
	if rapid.IntRange(0, 3).Draw(t, "place?") == 0 {
		in["location"] = rapid.SampledFrom([]string{"own", "visit"}).Draw(t, "place")
	}
	switch rapid.IntRange(0, 3).Draw(t, "fee") {
	case 0:
		in["fee"] = map[string]any{"cents": rapid.SampledFrom([]int64{0, 9500, 12000}).Draw(t, "cents")}
	case 1:
		if !isNew {
			in["fee"] = map[string]any{}
		}
	}
	switch rapid.IntRange(0, 5).Draw(t, "package") {
	case 0:
		in["package"] = map[string]any{"bought": map[string]any{
			"hours": rapid.SampledFrom([]int{1, 5}).Draw(t, "package hours"), "priceCents": rapid.SampledFrom([]int64{0, 40000}).Draw(t, "package price")}}
	case 1:
		in["package"] = map[string]any{}
	}
	if !isNew && rapid.Bool().Draw(t, "update the payment?") {
		in["updatePayment"] = true
	}
}

var moneyActions = []Action{
	{Name: "packages.create", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		in := map[string]any{
			"clientId": clientID(t, w), "hours": rapid.SampledFrom([]int{1, 5, 10}).Draw(t, "hours"),
			"priceCents": rapid.SampledFrom([]int64{0, 40000, 85000}).Draw(t, "price"), "purchasedAt": startTime(t, w),
		}
		if rapid.Bool().Draw(t, "paid there and then?") {
			in["payment"] = map[string]any{"payment": map[string]any{"method": "cash"}}
		}
		w.call(t, "packages.create", in)
	}},
	{Name: "packages.update", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		p := pick(t, w, "package", packages.Packages.All)
		in := map[string]any{"id": p.ID}
		switch rapid.IntRange(0, 4).Draw(t, "edit") {
		case 0:
			in["clientId"] = clientID(t, w)
		case 1:
			in["hours"] = rapid.SampledFrom([]int{1, 2, 5, 10}).Draw(t, "hours")
		case 2:
			in["priceCents"] = rapid.SampledFrom([]int64{0, 40000, 85000}).Draw(t, "price")
		case 3:
			in["purchasedAt"] = startTime(t, w)
		case 4:
			in["note"] = "Gift"
		}
		// What its dialog's payment section sends: the payment recorded
		// again (as the form does with a new price), another, or undone.
		switch rapid.IntRange(0, 3).Draw(t, "payment") {
		case 0:
			in["payment"] = map[string]any{"payment": map[string]any{
				"method": rapid.SampledFrom([]string{"cash", "tng", "bank_transfer"}).Draw(t, "method"),
				"paidOn": rapid.SampledFrom([]string{"", "2026-01-15"}).Draw(t, "paid on"),
			}}
		case 1:
			in["payment"] = map[string]any{}
		}
		v := packageView(t, w, p)
		w.callAsLocked(t, "packages.update", in, v.Locked, packages.Fields{}, packageChanges(v, in)...)
	}},
	{Name: "packages.delete", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		v := packageView(t, w, pick(t, w, "package", packages.Packages.All))
		w.callAsViewed(t, "packages.delete", map[string]any{"id": v.ID}, v.Can.Delete)
	}},
	{Name: "packages.makeStandalone", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		v := packageView(t, w, pick(t, w, "package", packages.Packages.All))
		w.callAsViewed(t, "packages.makeStandalone", map[string]any{"id": v.ID}, v.Can.MakeStandalone)
	}},
	{Name: "payments.set", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		var payment map[string]any
		if rapid.IntRange(0, 3).Draw(t, "undo?") > 0 {
			payment = map[string]any{"method": rapid.SampledFrom([]string{"cash", "tng", "bank_transfer"}).Draw(t, "method")}
		}
		if rapid.Bool().Draw(t, "a session?") {
			s := pick(t, w, "session", sessions.Sessions.All)
			v := sessionView(t, w, s)
			viewed := v.Can.Pay
			if payment == nil {
				viewed = v.Can.UndoPayment
			}
			items := []map[string]any{{"kind": "session", "id": s.ID}}
			if v.Bought != nil && rapid.Bool().Draw(t, "and its package?") {
				items = append(items, map[string]any{"kind": "package", "id": v.Bought.ID})
				w.call(t, "payments.set", map[string]any{"items": items, "payment": payment})
				return
			}
			w.callAsViewed(t, "payments.set", map[string]any{"items": items, "payment": payment}, viewed)
			return
		}
		v := packageView(t, w, pick(t, w, "package", packages.Packages.All))
		viewed := v.Can.Pay
		if payment == nil {
			viewed = v.Can.UndoPayment
		}
		w.callAsViewed(t, "payments.set", map[string]any{"items": []map[string]any{{"kind": "package", "id": v.ID}}, "payment": payment}, viewed)
	}},
	{Name: "documents.saveDraft", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		d := pick(t, w, "draft", drafts)
		var c documents.Content
		b, _ := json.Marshal(d.Draft)
		_ = json.Unmarshal(b, &c)
		locked := read(t, w, func(*txn.Tx) (apperr.Locks, error) { return documents.Locks(d) })
		var changed []string
		switch rapid.SampledFrom([]string{"amount", "description", "name", "date", "notes", "drop a line", "add a line"}).Draw(t, "change") {
		case "amount":
			if len(c.Lines) > 0 {
				c.Lines[0].AmountCents = rapid.SampledFrom([]int64{0, 5000, 9500}).Draw(t, "amount")
				if c.Lines[0].AmountCents != d.Draft.Lines[0].AmountCents {
					changed = append(changed, "lines.amountCents")
				}
			}
		case "description":
			if len(c.Lines) > 0 {
				c.Lines[0].Description = "Physio, knee"
			}
		case "name":
			c.Recipient.Name = "Jane S."
		case "date":
			c.Date = "2026-10-15"
			if c.Date != d.Draft.Date {
				changed = append(changed, "date")
			}
		case "notes":
			c.Notes = "Thank you"
		case "drop a line":
			if len(c.Lines) > 0 {
				c.Lines = c.Lines[1:]
				changed = append(changed, "lines")
			}
		case "add a line":
			c.Lines = append(c.Lines, documents.Line{Description: "Tape", AmountCents: 1500})
			changed = append(changed, "lines")
		}
		w.callAsLocked(t, "documents.saveDraft", map[string]any{"id": d.ID, "content": c}, locked, documents.Content{}, changed...)
	}},
	{Name: "documents.issue", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		d := pick(t, w, "document", documents.Documents.All)
		w.callAsViewed(t, "documents.issue", map[string]any{"id": d.ID}, documentCan(t, w, d).Issue)
	}},
	{Name: "documents.revise", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		d := pick(t, w, "document", documents.Documents.All)
		w.callAsViewed(t, "documents.revise", map[string]any{"id": d.ID}, documentCan(t, w, d).Revise)
	}},
	{Name: "documents.discardDraft", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		d := pick(t, w, "document", documents.Documents.All)
		w.callAsViewed(t, "documents.discardDraft", map[string]any{"id": d.ID}, documentCan(t, w, d).DiscardDraft)
	}},
	{Name: "documents.cancel", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		d := pick(t, w, "document", documents.Documents.All)
		w.callAsViewed(t, "documents.cancel", map[string]any{"id": d.ID, "reason": "Wrong"}, documentCan(t, w, d).Cancel)
	}},
	{Name: "documents.moveLines", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		from := pick(t, w, "document", documents.Documents.All)
		c := from.Draft
		if c == nil {
			c = from.Content
		}
		if len(c.Lines) == 0 {
			t.Skip("no lines")
		}
		in := map[string]any{"from": from.ID, "lineIds": []string{c.Lines[0].ID}}
		if rapid.Bool().Draw(t, "onto another?") {
			in["to"] = pick(t, w, "document", documents.Documents.All).ID
		}
		w.callRefusedAsViewed(t, "documents.moveLines", in, documentCan(t, w, from).MoveLines)
	}},
	{Name: "documents.combine", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		into := pick(t, w, "draft", drafts)
		other := pick(t, w, "document", documents.Documents.All)
		// As the web puts ticked documents together: each can move its
		// lines, and they share a combine key.
		a, b := documentView(t, w, into), documentView(t, w, other)
		viewed := a.Can.MoveLines
		switch {
		case !viewed.OK:
		case !b.Can.MoveLines.OK:
			viewed = b.Can.MoveLines
		case a.CombineKey != b.CombineKey:
			viewed = apperr.Verdict{Why: "not of one type and client"}
		}
		w.callAsViewed(t, "documents.combine", map[string]any{"ids": []string{into.ID, other.ID}}, viewed)
	}},
	{Name: "documents.place", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		into := ""
		if rapid.Bool().Draw(t, "onto a draft?") {
			into = pick(t, w, "draft", drafts).ID
		}
		item := map[string]any{"kind": "package", "id": pick(t, w, "package", packages.Packages.All).ID}
		if rapid.Bool().Draw(t, "a session?") {
			item = map[string]any{"kind": "session", "id": pick(t, w, "session", sessions.Sessions.All).ID}
		}
		kind := rapid.SampledFrom([]string{"invoice", "receipt"}).Draw(t, "type")
		w.call(t, "documents.place", map[string]any{"type": kind, "into": into, "items": []map[string]any{item}})
	}},
	{Name: "documents.share", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		w.call(t, "documents.share", map[string]any{"ids": []string{pick(t, w, "document", documents.Documents.All).ID}})
	}},
	{Name: "documents.resetShare", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		w.call(t, "documents.resetShare", map[string]any{"id": pick(t, w, "document", documents.Documents.All).ID})
	}},
}

// drafts are the documents being edited.
func drafts(tx *txn.Tx) ([]*documents.Document, error) {
	all, err := documents.Documents.All(tx)
	return slices.DeleteFunc(all, func(d *documents.Document) bool { return d.Draft == nil }), err
}

var followUpActions = []Action{
	{Name: "followUps.create", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		in := map[string]any{"clientId": clientID(t, w), "when": when(t, w), "summary": "call back", "notes": "About the knee"}
		if rapid.Bool().Draw(t, "from a session?") {
			s := pick(t, w, "session", sessions.Sessions.All)
			in["sessionId"], in["clientId"] = s.ID, s.ClientID
		}
		w.call(t, "followUps.create", in)
	}},
	{Name: "followUps.update", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		fu := pick(t, w, "follow-up", followups.FollowUps.All)
		in := map[string]any{"id": fu.ID}
		switch rapid.IntRange(0, 3).Draw(t, "edit") {
		case 0:
			in["clientId"] = clientID(t, w)
		case 1:
			in["when"] = when(t, w)
		case 2:
			in["summary"] = rapid.SampledFrom([]string{"", "text back"}).Draw(t, "summary")
		case 3:
			in["notes"] = "Changed"
		}
		w.call(t, "followUps.update", in)
	}},
	{Name: "followUps.delete", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		w.call(t, "followUps.delete", map[string]any{"id": pick(t, w, "follow-up", followups.FollowUps.All).ID})
	}},
	{Name: "followUps.reachedOut", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		w.call(t, "followUps.reachedOut", map[string]any{"clientId": clientID(t, w)})
	}},
	{Name: "followUps.setDone", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		fu := pick(t, w, "follow-up", followups.FollowUps.All)
		w.call(t, "followUps.setDone", map[string]any{"id": fu.ID, "done": fu.DoneAt == nil})
	}},
}

func when(t *rapid.T, w *World) map[string]any {
	if rapid.Bool().Draw(t, "all day?") {
		return map[string]any{"date": startTime(t, w).In(time.FixedZone("MYT", 8*3600)).Format(time.DateOnly)}
	}
	return map[string]any{"start": startTime(t, w), "minutes": rapid.SampledFrom([]int{0, 15, 30}).Draw(t, "minutes")}
}

var fileActions = []Action{
	{Name: "attachments.confirm", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		kind, owner := "expense", ""
		if rapid.Bool().Draw(t, "on a session?") {
			kind, owner = "session", pick(t, w, "session", sessions.Sessions.All).ID
		} else {
			owner = pick(t, w, "expense", expenses.Expenses.All).ID
		}
		file := map[string]any{"ownerKind": kind, "ownerId": owner, "name": "scan.pdf", "contentType": "application/pdf", "sizeBytes": 2048}
		data, refused := w.call(t, "attachments.requestUpload", file)
		if refused != nil {
			return
		}
		var ticket attachments.Ticket
		_ = json.Unmarshal(data, &ticket)
		if rapid.IntRange(0, 4).Draw(t, "upload?") > 0 {
			_ = w.Blobs.Upload(strings.TrimPrefix(ticket.Upload.URL, "memblob://"))
		}
		w.call(t, "attachments.confirm", map[string]any{"ownerKind": kind, "ownerId": owner, "id": ticket.ID, "name": "scan.pdf", "contentType": "application/pdf"})
	}},
	{Name: "attachments.delete", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		w.call(t, "attachments.delete", map[string]any{"id": pick(t, w, "file", attachments.Attachments.All).ID})
	}},
	{Name: "expenses.create", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		w.call(t, "expenses.create", receipt(t))
	}},
	{Name: "expenses.update", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		in := receipt(t)
		in["id"] = pick(t, w, "expense", expenses.Expenses.All).ID
		w.call(t, "expenses.update", in)
	}},
	{Name: "expenses.delete", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		w.call(t, "expenses.delete", map[string]any{"id": pick(t, w, "expense", expenses.Expenses.All).ID})
	}},
	{Name: "expenses.saveItem", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		it := pick(t, w, "item", expenses.Items.All)
		w.call(t, "expenses.saveItem", map[string]any{
			"id": it.ID, "name": rapid.SampledFrom([]string{"Kinesio tape", "Gel", "Parking"}).Draw(t, "name"),
			"categoryId": rapid.SampledFrom([]string{"purchases", "travel", "nowhere"}).Draw(t, "category"), "archived": rapid.Bool().Draw(t, "archived"),
		})
	}},
	{Name: "expenses.archiveVendor", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		w.call(t, "expenses.archiveVendor", map[string]any{
			"id": pick(t, w, "vendor", expenses.Vendors.All).ID, "archived": rapid.Bool().Draw(t, "archived"),
		})
	}},
	{Name: "expenses.saveCategories", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		cats := read(t, w, expenses.CategoriesOf)
		var out []map[string]any
		for _, c := range cats {
			out = append(out, map[string]any{"id": c.ID, "name": c.Name, "archived": c.Archived})
		}
		switch rapid.IntRange(0, 3).Draw(t, "edit") {
		case 0:
			out[0]["name"] = "Supplies"
		case 1:
			out = append(out, map[string]any{"name": "Training"})
		case 2:
			out[1]["archived"] = true
		case 3:
			out = out[1:]
		}
		w.call(t, "expenses.saveCategories", map[string]any{"categories": out})
	}},
}

func receipt(t *rapid.T) map[string]any {
	return map[string]any{
		"date":   rapid.SampledFrom([]string{"2026-10-12", "2026-10-13", "not a day"}).Draw(t, "date"),
		"vendor": rapid.SampledFrom([]string{"Shopee", "  shopee ", "Guardian", ""}).Draw(t, "vendor"),
		"lines": []map[string]any{{
			"name":        rapid.SampledFrom([]string{"Kinesio tape", "kinesio  TAPE", "Parking"}).Draw(t, "item"),
			"categoryId":  rapid.SampledFrom([]string{"purchases", "travel"}).Draw(t, "category"),
			"amountCents": rapid.SampledFrom([]int64{0, 300, 4500}).Draw(t, "amount"),
		}},
	}
}

var syncActions = []Action{
	{Name: "sync.run", Actor: ActorUser, Syncs: true, Run: func(t *rapid.T, w *World) {
		w.call(t, "sync.run", nil)
		w.InSync = true
	}},
	{Name: "sync.backfill", Actor: ActorUser, Syncs: true, Run: func(t *rapid.T, w *World) {
		// Older events only: the calendar shows bizzy as before.
		w.call(t, "sync.backfill", nil)
	}},
	{Name: "data.reset", Actor: ActorUser, Syncs: true, Run: func(t *rapid.T, w *World) {
		// Everything goes but the calendar, which is read back in: its
		// events now name clients that are gone, and wait as conflicts.
		w.call(t, "data.reset", nil)
		w.InSync = true
	}},
	{Name: "calendar.revert", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		w.call(t, "calendar.revert", map[string]any{"id": pick(t, w, "conflict", conflicts.Conflicts.All).EventID})
	}},
	{Name: "conflicts.apply", Actor: ActorUser, Run: func(t *rapid.T, w *World) {
		w.callRefreshing(t, "conflicts.apply", map[string]any{"id": pick(t, w, "conflict", conflicts.Conflicts.All).EventID})
	}},
}

// sessionView is a session as the app shows it.
// sessionChanges are the fields an update of a session changes.
func sessionChanges(v sessions.View, in map[string]any) []string {
	var out []string
	if id, ok := in["clientId"]; ok && id != v.ClientID {
		out = append(out, "clientId")
	}
	if tentative, ok := in["tentative"]; ok && tentative != v.Tentative {
		out = append(out, "tentative")
	}
	if fee, ok := in["fee"].(map[string]any); ok && fee["cents"] != nil && fee["cents"] != v.FeeCents {
		out = append(out, "fee")
	}
	if pkg, ok := in["package"].(map[string]any); ok {
		bought, _ := pkg["bought"].(map[string]any)
		switch {
		case bought == nil && v.Bought != nil,
			bought != nil && (v.Bought == nil || bought["hours"] != v.Bought.Hours || bought["priceCents"] != v.Bought.PriceCents):
			out = append(out, "package")
		}
	}
	return out
}

// packageChanges are the fields an update of a package changes.
func packageChanges(v packages.View, in map[string]any) []string {
	var out []string
	if id, ok := in["clientId"]; ok && id != v.ClientID {
		out = append(out, "clientId")
	}
	if hours, ok := in["hours"]; ok && hours != v.Hours {
		out = append(out, "hours")
	}
	if price, ok := in["priceCents"]; ok && price != v.PriceCents {
		out = append(out, "priceCents")
	}
	if at, ok := in["purchasedAt"].(time.Time); ok && !at.Equal(v.PurchasedAt) {
		out = append(out, "purchasedAt")
	}
	if _, ok := in["payment"]; ok && (in["payment"].(map[string]any)["payment"] != nil || v.Paid != nil) {
		out = append(out, "payment")
	}
	return out
}

// clientView is a client, drawn, as the app shows it.
func clientView(t *rapid.T, w *World) clients.View {
	return viewOf[clients.View](t, w, "clients.get", pick(t, w, "client", clients.Clients.All).ID)
}

// packageView is a package as the app shows it.
func packageView(t *rapid.T, w *World, p *packages.Package) packages.View {
	return read(t, w, func(tx *txn.Tx) (packages.View, error) { return packages.ViewOf(tx, p, sessions.CreditsUsed) })
}

// documentCan is what a document's page says each action on it would do.
func documentCan(t *rapid.T, w *World, d *documents.Document) documents.Can {
	return viewOf[struct {
		Can documents.Can `json:"can"`
	}](t, w, "documents.get", d.ID).Can
}

func documentView(t *rapid.T, w *World, d *documents.Document) documents.View {
	return viewOf[documents.View](t, w, "documents.get", d.ID)
}

func sessionView(t *rapid.T, w *World, s *sessions.Session) sessions.View {
	return read(t, w, func(tx *txn.Tx) (sessions.View, error) { return sessions.ViewOf(tx, s) })
}

// clientID draws a client's id, now and then one that doesn't exist.
func clientID(t *rapid.T, w *World) string {
	all := read(t, w, clients.Clients.All)
	if len(all) == 0 || rapid.IntRange(0, 9).Draw(t, "no such client?") == 0 {
		return "nobody"
	}
	return rapid.SampledFrom(all).Draw(t, "client").ID
}

// span draws a session from the hour, around now, so sessions often meet.
func span(t *rapid.T, w *World) map[string]any {
	start := startTime(t, w)
	return map[string]any{"start": start, "end": start.Add(length(t))}
}

// length draws up to two hours, often lengths that are charged rounded
// down to the half hour, or up to one.
func length(t *rapid.T) time.Duration {
	return time.Duration(rapid.SampledFrom([]int{60, 60, 120, 20, 45, 80, 90}).Draw(t, "minutes")) * time.Minute
}

func startTime(t *rapid.T, w *World) time.Time {
	return w.Now.Truncate(time.Hour).Add(time.Duration(rapid.IntRange(-24, 48).Draw(t, "hour")) * time.Hour)
}

// conflictIDs are the events waiting as conflicts.
func conflictIDs(t *rapid.T, w *World) map[string]bool {
	out := map[string]bool{}
	for _, c := range read(t, w, conflicts.Conflicts.All) {
		out[c.EventID] = true
	}
	return out
}
