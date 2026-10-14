// Package memdocs is an in-memory documents.Store over a memory.Store, so
// the links a document holds on sessions and packages land on the same
// items the other repositories read. It lives apart from memory because the
// documents tests use memory themselves.
package memdocs

import (
	"context"
	"slices"
	"strings"

	"bizzy-lambda/internal/features/documents"
	"bizzy-lambda/internal/platform/dynamo"
	"bizzy-lambda/internal/shared/docref"
	"bizzy-lambda/internal/testutil/memory"
)

type Repo struct {
	m         *memory.Store
	Docs      map[string]documents.Document
	Revs      []documents.Revision
	Counters  map[string]int64
	SharesMap map[string]string
}

func New(m *memory.Store) *Repo {
	return &Repo{m: m, Docs: map[string]documents.Document{}, Counters: map[string]int64{}, SharesMap: map[string]string{}}
}

func (r *Repo) Get(_ context.Context, id string) (documents.Document, bool, error) {
	d, ok := r.Docs[id]
	return d, ok, nil
}

func (r *Repo) sorted(keep func(documents.Document) bool) []documents.Document {
	var out []documents.Document
	for _, d := range r.Docs {
		if keep(d) {
			out = append(out, d)
		}
	}
	// Newest first, as the indexes return them.
	slices.SortFunc(out, func(a, b documents.Document) int {
		return strings.Compare(b.Date+b.CreatedAt.String()+b.ID, a.Date+a.CreatedAt.String()+a.ID)
	})
	return out
}

func (r *Repo) ListByMonth(_ context.Context, docType documents.Type, month string) ([]documents.Document, error) {
	return r.sorted(func(d documents.Document) bool { return d.Type == docType && strings.HasPrefix(d.Date, month+"-") }), nil
}

func (r *Repo) ListByClient(_ context.Context, clientID string) ([]documents.Document, error) {
	return r.sorted(func(d documents.Document) bool { return d.ClientID == clientID }), nil
}

func (r *Repo) SharedID(_ context.Context, token string) (string, bool, error) {
	id, ok := r.SharesMap[token]
	return id, ok, nil
}

func (r *Repo) Revisions(_ context.Context, id string) ([]documents.Revision, error) {
	var out []documents.Revision
	for _, rev := range r.Revs {
		if rev.DocumentID == id {
			out = append(out, rev)
		}
	}
	return out, nil
}

func (r *Repo) Counter(_ context.Context, key string) (int64, error) {
	return r.Counters[key], nil
}

// Commit checks every condition the DynamoDB transaction does before it
// applies anything, so a refused write changes nothing.
func (r *Repo) Commit(_ context.Context, w documents.Write) error {
	r.m.BeforeWrite("documents.commit")
	existing, exists := r.Docs[w.Doc.ID]
	if (w.PreviousVersion == 0 && exists) || (w.PreviousVersion > 0 && (!exists || existing.Version != w.PreviousVersion)) {
		return dynamo.ErrTransactionConflict
	}
	if c := w.Counter; c != nil && r.Counters[c.Key] != c.Prev {
		return dynamo.ErrTransactionConflict
	}
	if rev := w.Revision; rev != nil && slices.ContainsFunc(r.Revs, func(x documents.Revision) bool {
		return x.DocumentID == rev.DocumentID && x.Revision == rev.Revision
	}) {
		return dynamo.ErrTransactionConflict
	}
	if s := w.Share; s != nil {
		if _, taken := r.SharesMap[s.New]; taken {
			return dynamo.ErrTransactionConflict
		}
	}
	for _, l := range w.Links {
		current, found := r.slot(l.Source, l.Slot)
		switch {
		case !found:
			return dynamo.ErrTransactionConflict
		case l.Ref != nil && current != nil && current.DocumentID != l.DocumentID:
			return dynamo.ErrTransactionConflict
		case l.Ref == nil && (current == nil || current.DocumentID != l.DocumentID):
			return dynamo.ErrTransactionConflict
		}
	}

	if w.Delete {
		delete(r.Docs, w.Doc.ID)
	} else {
		r.Docs[w.Doc.ID] = w.Doc
	}
	if c := w.Counter; c != nil {
		r.Counters[c.Key] = c.Next
	}
	if w.Revision != nil {
		r.Revs = append(r.Revs, *w.Revision)
	}
	if s := w.Share; s != nil {
		r.SharesMap[s.New] = w.Doc.ID
		if s.Old != "" {
			delete(r.SharesMap, s.Old)
		}
	}
	for _, l := range w.Links {
		r.setSlot(l.Source, l.Slot, l.Ref)
	}
	r.m.Writes++
	return nil
}

func (r *Repo) slot(src documents.Source, slot docref.Slot) (*docref.Ref, bool) {
	if src.Kind == documents.SourcePackage {
		p, ok := r.m.PackageMap[src.ID]
		return p.Ref(slot), ok
	}
	s, ok := r.m.SessionMap[src.ID]
	return s.Ref(slot), ok
}

// setSlot writes the slot and, on a session, bumps its version as the
// patch does, so a session read before can't be saved over the link.
func (r *Repo) setSlot(src documents.Source, slot docref.Slot, ref *docref.Ref) {
	if src.Kind == documents.SourcePackage {
		p := r.m.PackageMap[src.ID]
		if slot == docref.SlotInvoice {
			p.Invoice = ref
		} else {
			p.Receipt = ref
		}
		r.m.PackageMap[src.ID] = p
		return
	}
	s := r.m.SessionMap[src.ID]
	if slot == docref.SlotInvoice {
		s.Invoice = ref
	} else {
		s.Receipt = ref
	}
	s.Version++
	r.m.SessionMap[src.ID] = s
}
