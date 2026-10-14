package integrity

import (
	"fmt"
	"slices"

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

// Links are the rules between documents and what they cover: a document
// covers any number of sessions and packages, each of which holds at most
// one document per type, in its slot.
var Links = []Rule{
	{
		ID:  "slot-points-at-a-live-document",
		Why: "A session's or package's invoice or receipt slot holds a draft or issued document of that type which lists it",
		Broken: func(w World) []string {
			var out []string
			for _, it := range w.items() {
				for _, slot := range docref.Slots {
					ref := it.ref(slot)
					if ref == nil {
						continue
					}
					d, ok := w.Documents[ref.DocumentID]
					switch {
					case !ok:
						out = append(out, fmt.Sprintf("%s %s holds document %s, which doesn't exist", it.src.Kind, it.src.ID, ref.DocumentID))
					case d.Status == documents.StatusCancelled:
						out = append(out, fmt.Sprintf("%s %s still holds cancelled %s %s", it.src.Kind, it.src.ID, d.Type, d.Number))
					case documents.Types[d.Type].Slot != slot:
						out = append(out, fmt.Sprintf("%s %s holds %s %s in its %s slot", it.src.Kind, it.src.ID, d.Type, d.ID, slot))
					case !slices.Contains(d.Sources, it.src):
						out = append(out, fmt.Sprintf("%s %s holds %s %s, which doesn't list it", it.src.Kind, it.src.ID, d.Type, d.ID))
					}
				}
			}
			return out
		},
		ByConstruction: "every document write links and unlinks its sources in the same transaction",
	},
	{
		ID:  "document-sources-point-back",
		Why: "Every session and package a live document lists holds it in its slot",
		Broken: func(w World) []string {
			var out []string
			for _, d := range w.documents() {
				if d.Status == documents.StatusCancelled {
					continue
				}
				slot := documents.Types[d.Type].Slot
				for _, src := range d.Sources {
					it, ok := w.item(src)
					if !ok {
						out = append(out, fmt.Sprintf("%s %s covers %s %s, which doesn't exist", d.Type, d.ID, src.Kind, src.ID))
						continue
					}
					if ref := it.ref(slot); ref == nil || ref.DocumentID != d.ID {
						out = append(out, fmt.Sprintf("%s %s covers %s %s, whose %s slot doesn't hold it", d.Type, d.ID, src.Kind, src.ID, slot))
					}
				}
			}
			return out
		},
		GuardedBy:      []string{"sessions.discard", "sessions.delete", "packages.delete"},
		ByConstruction: "an item with a document is never deleted (the repositories' conditions)",
	},
	{
		ID:  "slot-matches-the-issued-revision",
		Why: "A slot says the number, revision and client of the document as last issued, which drift is checked against",
		Broken: func(w World) []string {
			var out []string
			for _, it := range w.items() {
				for _, slot := range docref.Slots {
					ref := it.ref(slot)
					d, ok := w.Documents[refID(ref)]
					if !ok {
						continue
					}
					switch {
					case ref.Issued() != (d.Number != ""):
						out = append(out, fmt.Sprintf("%s %s: slot issued %v, %s %s issued %v", it.src.Kind, it.src.ID, ref.Issued(), d.Type, d.ID, d.Number != ""))
					case ref.Issued() && (ref.Number != d.Number || ref.Revision != *d.Revision || ref.ClientID != d.ClientID):
						out = append(out, fmt.Sprintf("%s %s: slot says %s rev %d for %s, document %s rev %d for %s", it.src.Kind, it.src.ID, ref.Number, ref.Revision, ref.ClientID, d.Number, *d.Revision, d.ClientID))
					}
				}
			}
			return out
		},
		ByConstruction: "issuing rewrites every source's slot in the same transaction",
	},
	{
		ID:  "session-client-change-is-flagged",
		Why: "When a session an issued document covers now belongs to another client, the session says so (drift)",
		Broken: func(w World) []string {
			return clientChanges(w, documents.SourceSession, func(id string) bool { return w.Sessions[id].Drift != "" })
		},
		GuardedBy:      []string{"documents.issue"},
		ByConstruction: "the reconcile flags drift on a session against its issued documents",
	},
	{
		ID:  "package-client-change-is-flagged",
		Why: "When a package an issued document covers now belongs to another client, the package says so (drift)",
		Broken: func(w World) []string {
			return clientChanges(w, documents.SourcePackage, func(id string) bool { return w.Packages[id].Drift != "" })
		},
		GuardedBy:      []string{"documents.issue"},
		ByConstruction: "the reconcile flags drift on a package against its issued documents",
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
					if !slices.ContainsFunc(w.Revisions, func(r documents.Revision) bool { return r.DocumentID == d.ID && r.Revision == rev }) {
						out = append(out, fmt.Sprintf("%s %s rev %d is missing", d.Type, d.Number, rev))
					}
				}
			}
			return out
		},
		ByConstruction: "issuing stores the revision in the same transaction",
	},
}

func refID(ref *docref.Ref) string {
	if ref == nil {
		return ""
	}
	return ref.DocumentID
}

// clientChanges lists the sources of a kind that issued documents cover
// for another client than they now belong to, unless flagged says so.
func clientChanges(w World, kind documents.SourceKind, flagged func(id string) bool) []string {
	var out []string
	for _, d := range w.documents() {
		if d.Status != documents.StatusIssued {
			continue
		}
		for _, src := range d.Sources {
			it, ok := w.item(src)
			if src.Kind != kind || !ok || it.clientID == d.ClientID || flagged(src.ID) {
				continue
			}
			out = append(out, fmt.Sprintf("%s %s is now %q's, but %s %s is for %q", src.Kind, src.ID, it.clientID, d.Type, d.Number, d.ClientID))
		}
	}
	return out
}
