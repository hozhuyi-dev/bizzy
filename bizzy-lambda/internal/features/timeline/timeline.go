// Package timeline is a client's story, newest first, a page at a time.
// Their sessions are its backbone, each with what came of it: the
// follow-ups made from it, its invoice and receipt, the package bought in
// it. Between them come the things that belong to no one session:
// follow-ups made on their own and done, packages bought on their own, and
// documents covering more than one session or package. Above what has
// happened comes what is coming: sessions booked, and follow-ups waiting
// (one overdue just above now, as it is waiting on the user).
//
// What has happened is read a page at a time. A page is a page of sessions, and it spans the time from the oldest of
// them to where the page before stopped. Everything else falls on the page
// whose span holds it, so paging through gives each entry once. A document
// falls where the newest thing it covers does.
package timeline

import (
	"cmp"
	"encoding/base64"
	"encoding/json"
	"slices"
	"time"

	"bizzy-lambda/internal/features/documents"
	"bizzy-lambda/internal/features/followups"
	"bizzy-lambda/internal/features/packages"
	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/platform/listing"
	"bizzy-lambda/internal/platform/txn"
)

// Kind is what an entry is.
type Kind string

const (
	KindSession  Kind = "session"
	KindFollowUp Kind = "followUp"
	KindDocument Kind = "document"
	KindPackage  Kind = "package"
)

// Entry is one thing in a client's story, at when it happened; exactly
// one of its parts is set, the one its Kind names.
type Entry struct {
	Kind     Kind            `json:"kind"`
	At       time.Time       `json:"at"`
	Session  *Session        `json:"session,omitempty"`
	FollowUp *followups.View `json:"followUp,omitempty"`
	Document *Document       `json:"document,omitempty"`
	Package  *Package        `json:"package,omitempty"`
}

// Session is a session with what came of it.
type Session struct {
	sessions.View
	// Excerpt is the part of its notes that has the words searched for.
	Excerpt   string           `json:"excerpt,omitempty"`
	FollowUps []followups.View `json:"followUps"`
	// Documents are its invoice and receipt, and those of the package
	// bought in it.
	Documents []DocumentRef `json:"documents"`
}

// Package is a package bought on its own, with its documents.
type Package struct {
	packages.View
	Documents []DocumentRef `json:"documents"`
}

// Document is a document covering more than one session or package.
type Document struct {
	documents.Summary
	// Covers is how many sessions and packages bought on their own it is
	// for.
	Covers int `json:"covers"`
}

// DocumentRef is a document an entry is on.
type DocumentRef struct {
	ID         string           `json:"id"`
	Type       documents.Type   `json:"type"`
	Status     documents.Status `json:"status"`
	Number     string           `json:"number,omitempty"`
	TotalCents int64            `json:"totalCents"`
	// Others is how many other sessions and packages it covers, each on
	// an entry of its own.
	Others int `json:"others"`
}

// Page is a page of what has happened; the first also has what is
// coming, all of it, as there is never much.
type Page struct {
	listing.Page[Entry]
	Upcoming []Entry `json:"upcoming,omitempty"`
}

// Search is a page of a client's story: newest first, only the kinds
// asked for (every kind when none are), and only what has the words.
func Search(tx *txn.Tx, clientID string, r listing.Request, kinds []Kind) (Page, error) {
	at, err := parseCursor(r.After)
	if err != nil {
		return Page{}, err
	}
	from, to, err := r.Span(tx.Location())
	if err != nil {
		return Page{}, err
	}
	words := r.Words()
	b := &builder{tx: tx, docs: map[string]bool{}}
	want := func(k Kind) bool { return listing.OneOf(kinds, k) }
	var upcoming []Entry
	if r.After == "" && r.From == "" && r.To == "" {
		if upcoming, err = b.upcoming(clientID, words, want); err != nil {
			return Page{}, err
		}
	}
	page, err := b.history(clientID, r, at, from, to, words, want)
	return Page{Page: page, Upcoming: upcoming}, err
}

// upcoming is what is coming, newest first: the sessions booked, and the
// follow-ups not done, by when due (an overdue one last, just above now).
func (b *builder) upcoming(clientID string, words listing.Words, want func(Kind) bool) ([]Entry, error) {
	tx, now := b.tx, b.tx.Now()
	var out []Entry
	if want(KindSession) {
		if _, err := sessions.Sessions.Each(tx, txn.List{Client: clientID, From: now, Latest: true}, "", func(s *sessions.Session) (bool, error) {
			if s.Start.Before(now) {
				return true, nil
			}
			excerpt, found, err := sessions.Search(tx, s, words)
			if err != nil || !found {
				return err == nil, err
			}
			e, err := b.session(s, excerpt)
			out = append(out, e)
			return true, err
		}); err != nil {
			return nil, err
		}
	}
	if want(KindFollowUp) {
		if _, err := followups.FollowUps.Each(tx, txn.List{Client: clientID, Latest: true}, "", func(fu *followups.FollowUp) (bool, error) {
			if fu.DoneAt != nil || !words.In(fu.Summary, fu.Notes) {
				return true, nil
			}
			v, err := followups.ViewOf(tx, fu)
			out = append(out, Entry{Kind: KindFollowUp, At: fu.Due, FollowUp: &v})
			return true, err
		}); err != nil {
			return nil, err
		}
	}
	// An overdue follow-up is still to do: it waits just above now.
	at := func(e Entry) time.Time { return later(e.At, now) }
	slices.SortStableFunc(out, func(a, b Entry) int { return cmp.Or(at(b).Compare(at(a)), b.At.Compare(a.At)) })
	return out, nil
}

func later(a, b time.Time) time.Time {
	if a.After(b) {
		return a
	}
	return b
}

// history is a page of what has happened (see the package doc).
func (b *builder) history(clientID string, r listing.Request, at cursor, from, to time.Time, words listing.Words, want func(Kind) bool) (listing.Page[Entry], error) {
	tx := b.tx
	// The page spans [start, end): end is where the page before stopped,
	// or now (or the last day asked for, if sooner).
	end := at.Before
	if end.IsZero() {
		end = tx.Now()
		if !to.IsZero() && to.Before(end) {
			end = to.Add(time.Second)
		}
	}

	var oldest time.Time
	sr := r
	sr.After = at.Sessions
	sessionList := txn.List{Client: clientID, From: from, To: end, Latest: true}
	page, err := listing.Read(tx, sessions.Sessions, sessionList, sr, func(s *sessions.Session) (Entry, bool, error) {
		oldest = s.Start
		if !s.Start.Before(end) {
			return Entry{}, false, nil
		}
		if err := b.noteDocuments(s.Source(), packageSource(tx, s.ID)); err != nil {
			return Entry{}, false, err
		}
		if !want(KindSession) {
			return Entry{}, false, nil
		}
		excerpt, found, err := sessions.Search(tx, s, words)
		if err != nil || !found {
			return Entry{}, false, err
		}
		e, err := b.session(s, excerpt)
		return e, err == nil, err
	})
	if err != nil {
		return listing.Page[Entry]{}, err
	}
	start := from
	if page.Next != "" {
		start = oldest
	}
	out := listing.Page[Entry]{Items: page.Items}
	if page.Next != "" {
		out.Next = formatCursor(cursor{Sessions: page.Next, Before: start})
	}
	inSpan := func(t time.Time) bool { return !t.Before(start) && t.Before(end) }
	span := txn.List{Client: clientID, From: start, To: end, Latest: true}

	// Packages bought on their own.
	if _, err := packages.Packages.Each(tx, span, "", func(p *packages.Package) (bool, error) {
		if p.BoughtIn != "" || !inSpan(p.PurchasedAt) {
			return true, nil
		}
		if err := b.noteDocuments(documents.PackageSource(p.ID)); err != nil {
			return false, err
		}
		if !want(KindPackage) || !words.In(p.Note, "package") {
			return true, nil
		}
		e, err := b.pkg(p)
		out.Items = append(out.Items, e)
		return true, err
	}); err != nil {
		return listing.Page[Entry]{}, err
	}

	// Follow-ups made on their own (or whose session is gone), done.
	if want(KindFollowUp) {
		if _, err := followups.FollowUps.Each(tx, span, "", func(fu *followups.FollowUp) (bool, error) {
			if fu.DoneAt == nil || !inSpan(fu.Due) || !words.In(fu.Summary, fu.Notes) {
				return true, nil
			}
			if fu.SessionID != "" {
				if _, kept, err := sessions.Sessions.Find(tx, fu.SessionID); err != nil || kept {
					return err == nil, err
				}
			}
			v, err := followups.ViewOf(tx, fu)
			out.Items = append(out.Items, Entry{Kind: KindFollowUp, At: fu.Due, FollowUp: &v})
			return true, err
		}); err != nil {
			return listing.Page[Entry]{}, err
		}
	}

	// Documents covering more than one thing, where the newest of them is.
	if want(KindDocument) {
		for _, id := range b.noted {
			d, err := documents.Documents.Get(tx, id)
			if err != nil {
				return listing.Page[Entry]{}, err
			}
			covers, newest, err := anchors(tx, d)
			if err != nil {
				return listing.Page[Entry]{}, err
			}
			s := documents.SummaryOf(d)
			if covers < 2 || !inSpan(newest) || !words.In(s.Number, s.RecipientName) {
				continue
			}
			out.Items = append(out.Items, Entry{Kind: KindDocument, At: newest, Document: &Document{Summary: s, Covers: covers}})
		}
	}

	// Newest first; a document before the newest thing it covers.
	order := map[Kind]int{KindDocument: 0, KindSession: 1, KindPackage: 2, KindFollowUp: 3}
	slices.SortStableFunc(out.Items, func(a, b Entry) int {
		return cmp.Or(b.At.Compare(a.At), cmp.Compare(order[a.Kind], order[b.Kind]))
	})
	return out, nil
}

// builder makes a page's entries, noting the documents they are on.
type builder struct {
	tx *txn.Tx
	// docs and noted are the live documents seen, in the order seen.
	docs  map[string]bool
	noted []string
}

// noteDocuments notes the documents covering items.
func (b *builder) noteDocuments(srcs ...documents.Source) error {
	for _, src := range srcs {
		if src.ID == "" {
			continue
		}
		for _, cover := range []func(*txn.Tx, documents.Source) (*documents.Document, *documents.Line, error){documents.Invoice, documents.Receipt} {
			d, _, err := cover(b.tx, src)
			if err != nil {
				return err
			}
			if d != nil && !b.docs[d.ID] {
				b.docs[d.ID] = true
				b.noted = append(b.noted, d.ID)
			}
		}
	}
	return nil
}

func (b *builder) session(s *sessions.Session, excerpt string) (Entry, error) {
	v, err := sessions.ViewOf(b.tx, s)
	if err != nil {
		return Entry{}, err
	}
	fus, err := followups.FollowUps.WithRef(b.tx, s.ID)
	if err != nil {
		return Entry{}, err
	}
	e := &Session{View: v, Excerpt: excerpt, FollowUps: []followups.View{}}
	for _, fu := range fus {
		fv, err := followups.ViewOf(b.tx, fu)
		if err != nil {
			return Entry{}, err
		}
		e.FollowUps = append(e.FollowUps, fv)
	}
	if e.Documents, err = refs(b.tx, s.Source(), packageSource(b.tx, s.ID)); err != nil {
		return Entry{}, err
	}
	return Entry{Kind: KindSession, At: s.Start, Session: e}, nil
}

func (b *builder) pkg(p *packages.Package) (Entry, error) {
	v, err := packages.ViewOf(b.tx, p, sessions.CreditsUsed)
	if err != nil {
		return Entry{}, err
	}
	e := &Package{View: v}
	if e.Documents, err = refs(b.tx, documents.PackageSource(p.ID)); err != nil {
		return Entry{}, err
	}
	return Entry{Kind: KindPackage, At: p.PurchasedAt, Package: e}, nil
}

// refs are the live documents covering an entry's items, invoices first.
func refs(tx *txn.Tx, srcs ...documents.Source) ([]DocumentRef, error) {
	out := []DocumentRef{}
	for _, cover := range []func(*txn.Tx, documents.Source) (*documents.Document, *documents.Line, error){documents.Invoice, documents.Receipt} {
		for _, src := range srcs {
			if src.ID == "" {
				continue
			}
			d, _, err := cover(tx, src)
			if err != nil {
				return nil, err
			}
			if d == nil || slices.ContainsFunc(out, func(r DocumentRef) bool { return r.ID == d.ID }) {
				continue
			}
			covers, _, err := anchors(tx, d)
			if err != nil {
				return nil, err
			}
			s := documents.SummaryOf(d)
			out = append(out, DocumentRef{ID: d.ID, Type: d.Type, Status: d.Status, Number: d.Number, TotalCents: s.TotalCents, Others: max(covers-1, 0)})
		}
	}
	return out, nil
}

// anchors counts the entries a document covers (a session, with the
// package bought in it; a package bought on its own), and when the newest
// of them is.
func anchors(tx *txn.Tx, d *documents.Document) (int, time.Time, error) {
	c := d.Counting()
	if c == nil {
		return 0, time.Time{}, nil
	}
	seen := map[string]bool{}
	var newest time.Time
	for _, line := range c.Lines {
		if line.Source == nil {
			continue
		}
		key, at, err := anchor(tx, *line.Source)
		if err != nil {
			return 0, time.Time{}, err
		}
		if key == "" || seen[key] {
			continue
		}
		seen[key] = true
		if at.After(newest) {
			newest = at
		}
	}
	return len(seen), newest, nil
}

// anchor is the entry an item is shown on, and when it is; "" for an item
// that is gone.
func anchor(tx *txn.Tx, src documents.Source) (string, time.Time, error) {
	if src.Kind == documents.SourcePackage {
		p, ok, err := packages.Packages.Find(tx, src.ID)
		switch {
		case err != nil || !ok:
			return "", time.Time{}, err
		case p.BoughtIn == "":
			return src.Key(), p.PurchasedAt, nil
		}
		src = documents.SessionSource(p.BoughtIn)
	}
	s, ok, err := sessions.Sessions.Find(tx, src.ID)
	if err != nil || !ok {
		return "", time.Time{}, err
	}
	return src.Key(), s.Start, nil
}

// packageSource is what the package bought in a session is on documents;
// an empty one when none was.
func packageSource(tx *txn.Tx, sessionID string) documents.Source {
	p, _ := packages.BoughtIn(tx, sessionID)
	if p == nil {
		return documents.Source{}
	}
	return documents.PackageSource(p.ID)
}

// cursor is where the next page starts: after a session, and before the
// time the page before spanned back to.
type cursor struct {
	Sessions string    `json:"s"`
	Before   time.Time `json:"t"`
}

func formatCursor(c cursor) string {
	b, _ := json.Marshal(c)
	return base64.RawURLEncoding.EncodeToString(b)
}

func parseCursor(s string) (cursor, error) {
	var c cursor
	if s == "" {
		return c, nil
	}
	raw, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil || json.Unmarshal(raw, &c) != nil || c.Sessions == "" {
		return cursor{}, apperr.Invalid("This list moved on; start it again.")
	}
	return c, nil
}
