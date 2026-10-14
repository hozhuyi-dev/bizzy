package book

import (
	"fmt"
	"slices"

	"bizzy-lambda/internal/features/documents"
	"bizzy-lambda/internal/features/packages"
	"bizzy-lambda/internal/features/sessions"
)

// The ledger: a session's or package's money is the lines covering it, in
// live documents. These change those lines wherever they are, issued
// documents included: a command does what it asks to the copy of the book,
// and the guards refuse it if that changes an issued document (see
// guards.go), so the operations below never need to know what is allowed.

func sessionSource(id string) documents.Source {
	return documents.Source{Kind: documents.SourceSession, ID: id}
}

func packageSource(id string) documents.Source {
	return documents.Source{Kind: documents.SourcePackage, ID: id}
}

// content is the content of a document that counts, to change in place:
// the draft of one never issued, the issued content otherwise.
func content(d *documents.Document) *documents.Content {
	switch d.Status {
	case documents.StatusDraft:
		return d.Draft
	case documents.StatusIssued:
		return d.Content
	}
	return nil
}

// located is one line covering an item.
type located struct {
	doc  *documents.Document
	line int
}

func (l located) Line() *documents.Line { return &content(l.doc).Lines[l.line] }

// lines are the lines covering an item in live documents of a type ("":
// any), in document order.
func (b *Book) lines(src documents.Source, docType documents.Type) []located {
	var out []located
	for _, id := range SortedIDs(b.Docs) {
		d := b.Docs[id]
		if !d.Live() || (docType != "" && d.Type != docType) {
			continue
		}
		for i, line := range content(d).Lines {
			if line.Source != nil && *line.Source == src {
				out = append(out, located{doc: d, line: i})
			}
		}
	}
	return out
}

// line is the first line covering an item in a live document of a type.
func (b *Book) line(src documents.Source, docType documents.Type) (located, bool) {
	all := b.lines(src, docType)
	if len(all) == 0 {
		return located{}, false
	}
	return all[0], true
}

// newDraft starts a document of a type for a client.
func (b *Book) newDraft(docType documents.Type, clientID string) *documents.Document {
	d := &documents.Document{
		ID: b.NewID(), Type: docType, Status: documents.StatusDraft, ClientID: clientID,
		Draft: &documents.Content{}, Sources: []documents.Source{}, CreatedAt: b.Now.UTC(),
	}
	b.Docs[d.ID] = d
	return d
}

// draftFor is the never-issued draft of a type for the client to add a
// line to: into, when it is one, else a new one.
func (b *Book) draftFor(docType documents.Type, clientID, into string) *documents.Document {
	if d, ok := b.Docs[into]; ok && d.Status == documents.StatusDraft && d.Type == docType && d.ClientID == clientID {
		return d
	}
	return b.newDraft(docType, clientID)
}

// addLine puts a line on a draft (see draftFor) and returns the draft.
func (b *Book) addLine(docType documents.Type, clientID, into string, line documents.Line) *documents.Document {
	d := b.draftFor(docType, clientID, into)
	if line.ID == "" {
		line.ID = b.NewID()
	}
	d.Draft.Lines = append(d.Draft.Lines, line)
	return d
}

// removeLines takes an item off documents of a type ("": any). A draft
// never issued that is left empty goes.
func (b *Book) removeLines(src documents.Source, docType documents.Type) {
	for _, l := range b.lines(src, docType) {
		c := content(l.doc)
		c.Lines = slices.DeleteFunc(c.Lines, func(line documents.Line) bool { return line.Source != nil && *line.Source == src })
		if l.doc.Status == documents.StatusDraft && len(c.Lines) == 0 {
			delete(b.Docs, l.doc.ID)
		}
	}
}

// setAmount sets what an item's lines of a type say.
func (b *Book) setAmount(src documents.Source, docType documents.Type, cents int64) {
	for _, l := range b.lines(src, docType) {
		l.Line().AmountCents = cents
	}
}

// moveToClient moves an item's lines onto drafts of another client: its
// invoice line to a new draft invoice, its receipt line to a new draft
// receipt paid the same way. Lines that move together (a session and the
// package bought in it) share the drafts given in into.
func (b *Book) moveToClient(src documents.Source, clientID string, into map[documents.Type]string) {
	for _, l := range b.lines(src, "") {
		if l.doc.ClientID == clientID {
			continue
		}
		line, docType := *l.Line(), l.doc.Type
		payment := content(l.doc).Payment
		b.removeLines(src, docType)
		d := b.addLine(docType, clientID, into[docType], line)
		d.Draft.Payment = payment
		into[docType] = d.ID
	}
}

// sessionLine is a session's fee on an invoice.
func (b *Book) sessionLine(s *sessions.Session, cents int64) documents.Line {
	src := sessionSource(s.ID)
	return documents.Line{
		Description: b.Settings.ServiceName,
		Date:        b.LocalDate(s.Start),
		AmountCents: cents,
		Source:      &src,
	}
}

// packageLine is a package's price on an invoice.
func (b *Book) packageLine(p *packages.Package, cents int64) documents.Line {
	src := packageSource(p.ID)
	return documents.Line{
		Description: b.packageDescription(p.Sessions),
		Date:        b.LocalDate(p.PurchasedAt),
		AmountCents: cents,
		Source:      &src,
	}
}

// packageDescription is how a package's line describes it.
func (b *Book) packageDescription(sessions int) string {
	return fmt.Sprintf("%s package (%d sessions)", b.Settings.ServiceName, sessions)
}

// resize says a package's new number of sessions on its draft lines, where
// they say the old one as drafted (a description she wrote herself is
// hers). An issued invoice keeps the size it was issued for (see the
// sold-packages-keep-their-size guard).
func (b *Book) resize(p *packages.Package, was int) {
	if was == p.Sessions {
		return
	}
	for _, l := range b.lines(packageSource(p.ID), "") {
		if line := l.Line(); l.doc.Status == documents.StatusDraft && line.Description == b.packageDescription(was) {
			line.Description = b.packageDescription(p.Sessions)
		}
	}
}

// date is the day an item is on its lines: when the session is, or the
// package was bought.
func (b *Book) date(src documents.Source) (string, bool) {
	if src.Kind == documents.SourcePackage {
		p, ok := b.Packages[src.ID]
		if !ok {
			return "", false
		}
		return b.LocalDate(p.PurchasedAt), true
	}
	s, ok := b.Sessions[src.ID]
	if !ok {
		return "", false
	}
	return b.LocalDate(s.Start), true
}

// redate moves an item's lines to its date: in place on a draft never
// issued; on an issued document, in the next revision, drafted on top of it
// if none is yet (the date is a correction a revision may make).
func (b *Book) redate(src documents.Source) {
	day, ok := b.date(src)
	if !ok {
		return
	}
	for _, l := range b.lines(src, "") {
		if l.doc.Status == documents.StatusDraft {
			l.Line().Date = day
			continue
		}
		if l.Line().Date == day && l.doc.Draft == nil {
			continue
		}
		if l.doc.Draft == nil {
			draft := deepCopy(*l.doc.Content)
			l.doc.Draft = &draft
		}
		for i := range l.doc.Draft.Lines {
			if line := &l.doc.Draft.Lines[i]; line.Source != nil && *line.Source == src {
				line.Date = day
			}
		}
	}
}
