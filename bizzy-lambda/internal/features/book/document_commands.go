package book

import (
	"slices"

	"bizzy-lambda/internal/features/documents"
	"bizzy-lambda/internal/platform/apperr"
)

// A document's steps: each refuses, as a Lifecycle problem, a document not
// at the step (the document-lifecycle guard), so the steps can only run in
// the order of the lifecycle (see documents).

func (b *Book) lifecycle(d *documents.Document, text string) {
	b.problem(Key("document", d.ID), Problem{Kind: Lifecycle, Text: text})
}

// SaveDraft replaces what a draft says: before it is first issued,
// anything, and an amount on an invoice is the fee of what the line
// covers; on a revision, only what a revision may correct (the
// revision-only-corrects guard). Lines keep what they cover; one for
// something the document doesn't cover is refused.
type SaveDraft struct {
	ID      string            `json:"id"`
	Version int               `json:"version"`
	Content documents.Content `json:"content"`
}

func (SaveDraft) Action() string { return "documents.saveDraft" }

func (c SaveDraft) Scope() Scope { return Scope{Documents: []string{c.ID}} }

func (c SaveDraft) Apply(b *Book) error {
	d, err := b.Doc(c.ID, c.Version)
	if err != nil {
		return err
	}
	if d.Draft == nil {
		b.lifecycle(d, "This document is not being edited.")
		return nil
	}
	in, err := documents.Normalize(c.Content)
	if err != nil {
		return err
	}
	covered := documents.SourceLines(d.Draft.Lines)
	for i := range in.Lines {
		line := &in.Lines[i]
		if line.Source != nil {
			if _, ok := covered[*line.Source]; !ok {
				return apperr.Invalid("line %d refers to something this document does not cover", i+1)
			}
		}
		if line.ID == "" || slices.ContainsFunc(in.Lines[:i], func(l documents.Line) bool { return l.ID == line.ID }) {
			line.ID = b.NewID()
		}
	}
	// What a receipt received, and how, is the payment's to change.
	in.Payment = d.Draft.Payment
	if d.Status == documents.StatusDraft && d.Type == documents.TypeInvoice {
		// An amount she changes is the fee she entered.
		for _, line := range in.Lines {
			if line.Source == nil || line.Source.Kind != documents.SourceSession {
				continue
			}
			if was := covered[*line.Source]; was.AmountCents != line.AmountCents {
				if s, ok := b.Sessions[line.Source.ID]; ok {
					s.FeeTyped = true
				}
			}
		}
	}
	d.Draft = &in
	return nil
}

// Issue makes a draft final: the first time it takes the next number (rev
// 0), afterwards it becomes the next revision under the same number. Its
// business, client and date are filled in as they are now (see
// documents.Fill), and it gets a share link.
type Issue struct {
	ID      string `json:"id"`
	Version int    `json:"version"`
}

func (Issue) Action() string { return "documents.issue" }

func (c Issue) Scope() Scope { return Scope{Documents: []string{c.ID}, Numbering: true} }

func (c Issue) Apply(b *Book) error {
	d, err := b.Doc(c.ID, c.Version)
	if err != nil {
		return err
	}
	if d.Draft == nil {
		b.lifecycle(d, "There is nothing to issue.")
		return nil
	}
	now := b.Now.UTC()
	content := documents.Fill(*d.Draft, b.Settings, b.Clients[d.ClientID])
	if content.Date == "" {
		content.Date = b.LocalDate(now)
	}
	content.TotalCents = content.Total()
	if d.Number == "" {
		local := now.In(b.Location)
		key := documents.CounterKey(d.Type, local)
		last := b.Counters[key]
		b.Counters[key] = last + 1
		b.Effects.Counters = append(b.Effects.Counters, documents.CounterBump{Key: key, Prev: last, Next: last + 1})
		d.Number = documents.Number(documents.Types[d.Type], local.Year(), last+1)
		d.Revision = ptr(0)
		d.IssuedAt = &now
	} else {
		d.Revision = ptr(*d.Revision + 1)
	}
	if d.ShareToken == "" {
		d.ShareToken = documents.NewShareToken()
		b.Effects.Shares = append(b.Effects.Shares, Share{DocumentID: d.ID, Change: documents.ShareChange{New: d.ShareToken}})
	}
	d.Status, d.Content, d.Draft = documents.StatusIssued, &content, nil
	b.Effects.Revisions = append(b.Effects.Revisions, documents.Revision{
		DocumentID: d.ID, Revision: *d.Revision, Number: d.Number, Content: content, IssuedAt: now,
	})
	return nil
}

// Revise opens an issued document for a correction. The issued revision
// stays the valid one until the next is issued.
type Revise struct {
	ID      string `json:"id"`
	Version int    `json:"version"`
}

func (Revise) Action() string { return "documents.revise" }

func (c Revise) Scope() Scope { return Scope{Documents: []string{c.ID}} }

func (c Revise) Apply(b *Book) error {
	d, err := b.Doc(c.ID, c.Version)
	if err != nil {
		return err
	}
	if d.Status != documents.StatusIssued || d.Draft != nil {
		b.lifecycle(d, "Only an issued document can be revised.")
		return nil
	}
	draft := deepCopy(*d.Content)
	d.Draft = &draft
	return nil
}

// DiscardDraft throws a draft away: a revision goes back to the issued
// one; a receipt never issued goes, with the payment it recorded. An
// invoice never issued holds the fees of what it covers, so it goes only
// with them, unless it holds only lines of her own (a sale of its own).
type DiscardDraft struct {
	ID      string `json:"id"`
	Version int    `json:"version"`
}

func (DiscardDraft) Action() string { return "documents.discardDraft" }

func (c DiscardDraft) Scope() Scope { return Scope{Documents: []string{c.ID}} }

func (c DiscardDraft) Apply(b *Book) error {
	d, err := b.Doc(c.ID, c.Version)
	if err != nil {
		return err
	}
	switch {
	case d.Draft == nil:
		b.lifecycle(d, "There is no draft to discard.")
	case d.Number != "":
		d.Draft = nil
	default:
		delete(b.Docs, d.ID)
	}
	return nil
}

// Cancel voids an issued document. Its number stays used and its revisions
// are kept. What it charged or recorded is still so, so its lines go back
// to a new draft: cancel an invoice to change a fee, then issue the draft
// again.
type Cancel struct {
	ID      string `json:"id"`
	Version int    `json:"version"`
	Reason  string `json:"reason"`
}

func (Cancel) Action() string { return "documents.cancel" }

func (c Cancel) Scope() Scope { return Scope{Documents: []string{c.ID}} }

func (c Cancel) Apply(b *Book) error {
	d, err := b.Doc(c.ID, c.Version)
	if err != nil {
		return err
	}
	if d.Status != documents.StatusIssued {
		b.lifecycle(d, "Only an issued document can be cancelled; a draft goes with what it covers.")
		return nil
	}
	now := b.Now.UTC()
	draft := b.newDraft(d.Type, d.ClientID)
	draft.Draft.Payment = d.Content.Payment
	for _, line := range d.Content.Lines {
		line.ID = b.NewID()
		draft.Draft.Lines = append(draft.Draft.Lines, line)
	}
	d.Status, d.Draft, d.CancelledAt, d.CancelReason = documents.StatusCancelled, nil, &now, c.Reason
	return nil
}

// MoveLines moves lines from one draft to another of the same client and
// type, never issued, or to a new one: to put a month of sessions on one
// invoice, or a package on its own. Receipts move only between drafts of
// the same payment. A draft left empty goes.
type MoveLines struct {
	From string `json:"from"`
	// To is "" for a new draft.
	To      string   `json:"to"`
	LineIDs []string `json:"lineIds"`
}

func (MoveLines) Action() string { return "documents.moveLines" }

func (c MoveLines) Scope() Scope {
	s := Scope{Documents: []string{c.From}}
	if c.To != "" {
		s.Documents = append(s.Documents, c.To)
	}
	return s
}

func (c MoveLines) Apply(b *Book) error {
	from, err := b.Doc(c.From, 0)
	if err != nil {
		return err
	}
	if len(c.LineIDs) == 0 {
		return apperr.Invalid("choose the lines to move")
	}
	if from.Status != documents.StatusDraft {
		b.lifecycle(from, "Lines move only between drafts not issued yet.")
		return nil
	}
	var to *documents.Document
	if c.To == "" {
		to = b.newDraft(from.Type, from.ClientID)
		to.Draft.Payment = from.Draft.Payment
	} else if to, err = b.Doc(c.To, 0); err != nil {
		return err
	}
	switch {
	case to.ID == from.ID:
		return apperr.Invalid("choose another draft")
	case to.Status != documents.StatusDraft:
		b.lifecycle(from, "Lines move only between drafts not issued yet.")
		return nil
	case to.Type != from.Type || to.ClientID != from.ClientID:
		b.lifecycle(from, "Lines move only between drafts of the same kind, for the same client.")
		return nil
	case !samePayment(to.Draft.Payment, from.Draft.Payment):
		b.lifecycle(from, "These receipts record different payments.")
		return nil
	}
	for _, id := range c.LineIDs {
		i := slices.IndexFunc(from.Draft.Lines, func(l documents.Line) bool { return l.ID == id })
		if i < 0 {
			return apperr.Invalid("that line isn't on this draft any more")
		}
		to.Draft.Lines = append(to.Draft.Lines, from.Draft.Lines[i])
		from.Draft.Lines = slices.Delete(from.Draft.Lines, i, i+1)
	}
	if len(from.Draft.Lines) == 0 {
		delete(b.Docs, from.ID)
	}
	return nil
}

func samePayment(a, b *documents.Payment) bool {
	return (a == nil && b == nil) || (a != nil && b != nil && *a == *b)
}
