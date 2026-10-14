package integrity

import (
	"fmt"
	"slices"

	"bizzy-lambda/internal/features/conflicts"
	"bizzy-lambda/internal/features/documents"
	"bizzy-lambda/internal/shared/docref"
)

// Rule is a rule across entities: Broken lists what breaks it, one entry
// per item, in a stable order.
type Rule struct {
	ID     string
	Why    string
	Broken func(w World) []string
	// GuardedBy and ByConstruction say why it can't break, as for an
	// Impossible statemodel rule.
	GuardedBy      []string
	ByConstruction string
	// Pending marks a known gap awaiting a decision, with the suggested
	// resolution: it is still checked and reported, but doesn't fail the
	// simulation. Fixing it means deleting this and making it hold.
	Pending string
	// Tolerated says it may break for a while by design, and what puts it
	// right: reported, but it doesn't fail the simulation.
	Tolerated string
}

// Links are the rules the books can't see: what each issued document keeps
// and opens, and what each calendar event shows.
var Links = []Rule{
	{
		ID:  "ref-says-the-document",
		Why: "A session's or package's link to a document says its number and revision as last issued",
		Broken: func(w World) []string {
			var out []string
			check := func(kind, id string, slot docref.Slot, ref *docref.Ref) {
				if ref == nil {
					return
				}
				d, ok := w.Documents[ref.DocumentID]
				switch {
				case !ok:
					out = append(out, fmt.Sprintf("%s %s holds document %s, which doesn't exist", kind, id, ref.DocumentID))
				case documents.Types[d.Type].Slot != slot:
					out = append(out, fmt.Sprintf("%s %s holds %s %s in its %s slot", kind, id, d.Type, d.ID, slot))
				case *ref != d.Ref():
					out = append(out, fmt.Sprintf("%s %s holds %+v, but %s %s is %+v", kind, id, *ref, d.Type, d.ID, d.Ref()))
				}
			}
			for _, id := range sortedKeys(w.Sessions) {
				s := w.Sessions[id]
				check("session", id, docref.SlotInvoice, s.Invoice)
				check("session", id, docref.SlotReceipt, s.Receipt)
			}
			for _, id := range sortedKeys(w.Packages) {
				p := w.Packages[id]
				check("package", id, docref.SlotInvoice, p.Invoice)
				check("package", id, docref.SlotReceipt, p.Receipt)
			}
			return out
		},
		ByConstruction: "the book copies every link from the documents on every write (book.Derive)",
	},
	{
		ID:  "share-links-open-their-document",
		Why: "Each issued document's link opens it, and a reset link opens nothing",
		Broken: func(w World) []string {
			var out []string
			for _, d := range w.documents() {
				if d.ShareToken != "" && w.Shares[d.ShareToken] != d.ID {
					out = append(out, fmt.Sprintf("%s %s's link opens %q", d.Type, d.ID, w.Shares[d.ShareToken]))
				}
			}
			for _, token := range sortedKeys(w.Shares) {
				if d, ok := w.Documents[w.Shares[token]]; !ok || d.ShareToken != token {
					out = append(out, fmt.Sprintf("an old link still opens document %s", w.Shares[token]))
				}
			}
			return out
		},
		ByConstruction: "a new link retires the old one in the same transaction",
	},
	{
		ID:  "every-issue-is-kept",
		Why: "Every revision issued is kept as it was, so its PDF can be rebuilt",
		Broken: func(w World) []string {
			var out []string
			for _, d := range w.documents() {
				if d.Revision == nil {
					continue
				}
				for rev := 0; rev <= *d.Revision; rev++ {
					i := slices.IndexFunc(w.Revisions, func(r documents.Revision) bool { return r.DocumentID == d.ID && r.Revision == rev })
					switch {
					case i < 0:
						out = append(out, fmt.Sprintf("%s %s rev %d is missing", d.Type, d.Number, rev))
					case rev == *d.Revision && d.Content != nil && !sameJSON(w.Revisions[i].Content, *d.Content):
						out = append(out, fmt.Sprintf("%s %s says other than its rev %d", d.Type, d.Number, rev))
					}
				}
			}
			return out
		},
		ByConstruction: "issuing stores the revision in the same transaction, and nothing else changes issued content",
	},
	{
		ID:  "events-show-their-item",
		Why: "A session's or follow-up's event shows it and nothing else: what the calendar record shows says the same",
		Broken: func(w World) []string {
			var out []string
			check := func(kind conflicts.ExternalKind, id, eventID string) {
				if eventID == "" {
					return
				}
				e, ok := w.Externals[conflicts.Key(conflicts.SurfaceCalendar, eventID)]
				if !ok || e.Kind != kind || e.ID != id {
					out = append(out, fmt.Sprintf("%s %s's event %s shows %+v", kind, id, eventID, e))
				}
			}
			for _, id := range sortedKeys(w.Sessions) {
				check(conflicts.ShowsSession, id, w.Sessions[id].Event.EventID)
			}
			for _, id := range sortedKeys(w.FollowUps) {
				check(conflicts.ShowsFollowUp, id, w.FollowUps[id].Event.EventID)
			}
			for _, key := range sortedKeys(w.Externals) {
				e := w.Externals[key]
				if eventID, ok := w.eventOf(e.Kind, e.ID); e.Kind != conflicts.Ignored && (!ok || eventID != e.ExternalID) {
					out = append(out, fmt.Sprintf("event %s shows %s %s, which shows another event or is gone", e.ExternalID, e.Kind, e.ID))
				}
			}
			return out
		},
		ByConstruction: "an item's event is recorded with it, in the same transaction, and forgotten with it",
	},
	{
		ID:  "conflicts-are-about-something",
		Why: "A conflict over an event is about the session or follow-up it shows, which exists",
		Broken: func(w World) []string {
			var out []string
			for _, key := range sortedKeys(w.Conflicts) {
				c := w.Conflicts[key]
				if _, ok := w.eventOf(conflicts.ExternalKind(c.TargetKind), c.TargetID); c.TargetID != "" && !ok {
					out = append(out, fmt.Sprintf("conflict %s is about %s %s, which is gone", key, c.TargetKind, c.TargetID))
				}
			}
			return out
		},
		ByConstruction: "deleting a session or follow-up drops any conflict over its event in the same transaction",
	},
}

// eventOf is the event of a session or follow-up, if it exists.
func (w World) eventOf(kind conflicts.ExternalKind, id string) (string, bool) {
	if kind == conflicts.ShowsFollowUp {
		f, ok := w.FollowUps[id]
		return f.Event.EventID, ok
	}
	s, ok := w.Sessions[id]
	return s.Event.EventID, ok
}
