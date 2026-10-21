package documents

import (
	"fmt"
	"slices"
	"strings"
	"time"

	"bizzy-lambda/internal/features/clients"
	"bizzy-lambda/internal/features/settings"
	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/platform/txn"
)

// A document's steps, each refusing a document not at it, so they run
// only in the order of the lifecycle (see the package doc).

func notAtStep(message string) error { return apperr.Refused(message) }

// stayIssued is the refusal for changing what has legal weight on an
// issued document (see Legal): what names it.
func stayIssued(d *Document, what string) error {
	return apperr.Refused(fmt.Sprintf("%s is issued, so %s can't change: cancel it first.", d.Number, what),
		apperr.Remedy{Action: "documents.cancel", Target: d.ID, Label: "Cancel " + d.Number})
}

// SaveDraft replaces what a draft says. Before the first issue anything
// may change, and an amount the user changes on an invoice is the fee they
// typed; a revision may only correct what has no legal weight (see
// Legal). Lines keep what they cover, and an invoice line for an item
// stays: the item is charged until it is deleted or moved.
func SaveDraft(tx *txn.Tx, id string, in Content) (*Document, error) {
	d, err := Documents.Get(tx, id)
	if err != nil {
		return nil, err
	}
	if d.Draft == nil {
		return nil, notAtStep("This document is not being edited.")
	}
	next, err := Normalize(in)
	if err != nil {
		return nil, err
	}
	was := SourceLines(d.Draft.Lines)
	for i := range next.Lines {
		line := &next.Lines[i]
		if line.Source != nil {
			before, ok := was[*line.Source]
			if !ok {
				return nil, apperr.Invalid("Line %d refers to something this document doesn't cover.", i+1)
			}
			line.Typed = before.Typed || (d.Type == TypeInvoice && before.AmountCents != line.AmountCents)
		}
		if line.ID == "" || slices.ContainsFunc(next.Lines[:i], func(l Line) bool { return l.ID == line.ID }) {
			line.ID = tx.NewID()
		}
	}
	now := SourceLines(next.Lines)
	for src, line := range was {
		if _, kept := now[src]; !kept && d.Type == TypeInvoice {
			return nil, apperr.Refused(fmt.Sprintf("%q stays on an invoice: move its line to another draft instead.", line.Description))
		}
	}
	// What a receipt received, and how, is the payment's to change.
	next.Payment, next.PaidBy = d.Draft.Payment, d.Draft.PaidBy
	if !covers(next.Lines) {
		return nil, apperr.Refused(fmt.Sprintf("A %s is for a session or package: keep a line for one, or discard the draft.", strings.ToLower(Types[d.Type].Title)),
			apperr.Remedy{Action: "documents.discardDraft", Target: d.ID, Label: "Discard the draft"})
	}
	if d.Issued() {
		if what := Legal(*d.Content, next); what != "" {
			return nil, stayIssued(d, what)
		}
	}
	d.Draft = &next
	for src := range was {
		tx.Later(func() error { return CheckPaid(tx, src) })
	}
	return d, relink(tx, d)
}

// Check is a rule another feature holds a document to before it is
// issued: an invoice is for confirmed sessions only. The app passes it
// in, as documents can't import the features of what they cover.
type Check func(tx *txn.Tx, d *Document) error

// Issue makes a draft final: the first time it takes the next number
// (revision 0), afterwards it becomes the next revision under the same
// number. The business, client and date are filled in as they are now
// (see Fill), and it gets a share link.
func Issue(tx *txn.Tx, id string, checks ...Check) (*Document, error) {
	d, err := Documents.Get(tx, id)
	if err != nil {
		return nil, err
	}
	if d.Draft == nil {
		return nil, notAtStep("There is nothing to issue.")
	}
	for _, check := range checks {
		if err := check(tx, d); err != nil {
			return nil, err
		}
	}
	cfg, err := settings.Get(tx)
	if err != nil {
		return nil, err
	}
	client, err := clients.Clients.Get(tx, d.ClientID)
	if err != nil {
		return nil, err
	}
	content := Fill(*d.Draft, cfg, *client)
	now := tx.Now().UTC()
	if content.Date == "" {
		content.Date = now.In(tx.Location()).Format(time.DateOnly)
	}
	content.TotalCents = content.Total()
	if d.Issued() {
		if what := Legal(*d.Content, content); what != "" {
			return nil, stayIssued(d, what)
		}
		next := *d.Revision + 1
		d.Revision = &next
	} else {
		if d.Number, err = nextNumber(tx, d.Type); err != nil {
			return nil, err
		}
		first := 0
		d.Revision, d.IssuedAt = &first, &now
	}
	if d.ShareToken == "" {
		if err := share(tx, d); err != nil {
			return nil, err
		}
	}
	d.Status, d.Content, d.Draft = StatusIssued, &content, nil
	if err := Revisions.Add(tx, &Revision{DocumentID: d.ID, Revision: *d.Revision, Number: d.Number, Content: content, IssuedAt: now}); err != nil {
		return nil, err
	}
	return d, relink(tx, d)
}

// Revise opens an issued document for a correction. The issued revision
// stays the one that counts until the next is issued.
func Revise(tx *txn.Tx, id string) (*Document, error) {
	d, err := Documents.Get(tx, id)
	if err != nil {
		return nil, err
	}
	if d.Status != StatusIssued || d.Draft != nil {
		return nil, notAtStep("Only an issued document can be revised.")
	}
	draft := clone(*d.Content)
	d.Draft = &draft
	return d, nil
}

// DiscardDraft throws a draft away: a revision goes back to the issued
// one; a receipt never issued goes, with the payments it recorded. An
// invoice never issued that charges anything goes only with what it
// charges.
func DiscardDraft(tx *txn.Tx, id string) (*Document, error) {
	d, err := Documents.Get(tx, id)
	if err != nil {
		return nil, err
	}
	switch {
	case d.Draft == nil:
		return nil, notAtStep("There is no draft to discard.")
	case d.Issued():
		d.Draft = nil
		return d, nil
	case d.Type == TypeInvoice && slices.ContainsFunc(d.Draft.Lines, func(l Line) bool { return l.Source != nil }):
		return nil, apperr.Refused("This draft charges what it covers, so it goes when they do: move its lines to another draft, or delete what it charges.")
	}
	if err := Documents.Delete(tx, d.ID); err != nil {
		return nil, err
	}
	return nil, relink(tx, d)
}

// Cancel voids an issued document. Its number stays used and its
// revisions are kept. What it charged or recorded is still so, so its
// lines go back to a new draft: cancel an invoice to change a fee, then
// issue the draft again.
func Cancel(tx *txn.Tx, id, reason string) (*Document, error) {
	d, err := Documents.Get(tx, id)
	if err != nil {
		return nil, err
	}
	if d.Status != StatusIssued {
		return nil, notAtStep("Only an issued document can be cancelled; a draft goes with what it covers.")
	}
	draft, err := newDraft(tx, d.Type, d.ClientID)
	if err != nil {
		return nil, err
	}
	setPayment(draft.Draft, d.Content.Payment)
	for _, line := range d.Content.Lines {
		line.ID = tx.NewID()
		draft.Draft.Lines = append(draft.Draft.Lines, line)
	}
	draft.Draft.TotalCents = draft.Draft.Total()
	now := tx.Now().UTC()
	d.Status, d.Draft, d.CancelledAt, d.CancelReason = StatusCancelled, nil, &now, reason
	if err := relink(tx, d); err != nil {
		return nil, err
	}
	return d, relink(tx, draft)
}

// MoveLines moves lines from one draft to another of the same client and
// type, neither issued, or to a new one: to put a month of sessions on one
// invoice, or a package on its own. Receipts move only between drafts of
// the same payment. A draft left covering nothing goes, its other lines
// with the ones moved; a new one must cover something.
func MoveLines(tx *txn.Tx, fromID, toID string, lineIDs []string) error {
	_, err := moveLines(tx, fromID, toID, lineIDs)
	return err
}

// moveLines is MoveLines, returning the draft the lines went to.
func moveLines(tx *txn.Tx, fromID, toID string, lineIDs []string) (*Document, error) {
	from, err := Documents.Get(tx, fromID)
	if err != nil {
		return nil, err
	}
	if len(lineIDs) == 0 {
		return nil, apperr.Invalid("Choose the lines to move.")
	}
	if from.Status != StatusDraft {
		return nil, notAtStep("Lines move only between drafts not issued yet.")
	}
	var to *Document
	if toID == "" {
		if to, err = newDraft(tx, from.Type, from.ClientID); err != nil {
			return nil, err
		}
		setPayment(to.Draft, from.Draft.Payment)
	} else if to, err = Documents.Get(tx, toID); err != nil {
		return nil, err
	}
	switch {
	case to.ID == from.ID:
		return nil, apperr.Invalid("Choose another draft.")
	case to.Status != StatusDraft:
		return nil, notAtStep("Lines move only between drafts not issued yet.")
	case to.Type != from.Type || to.ClientID != from.ClientID:
		return nil, notAtStep("Lines move only between drafts of the same kind, for the same client.")
	case !samePayment(to.Draft.Payment, from.Draft.Payment):
		return nil, notAtStep("These receipts record different payments.")
	}
	for _, id := range lineIDs {
		i := slices.IndexFunc(from.Draft.Lines, func(l Line) bool { return l.ID == id })
		if i < 0 {
			return nil, apperr.Invalid("That line isn't on this draft any more.")
		}
		to.Draft.Lines = append(to.Draft.Lines, from.Draft.Lines[i])
		from.Draft.Lines = slices.Delete(from.Draft.Lines, i, i+1)
	}
	if !covers(to.Draft.Lines) {
		return nil, apperr.Refused("A new draft is for a session or package: move a line for one with these.")
	}
	if !covers(from.Draft.Lines) {
		to.Draft.Lines = append(to.Draft.Lines, from.Draft.Lines...)
		if err := Documents.Delete(tx, from.ID); err != nil {
			return nil, err
		}
	}
	from.Draft.TotalCents, to.Draft.TotalCents = from.Draft.Total(), to.Draft.Total()
	if err := relink(tx, to); err != nil {
		return nil, err
	}
	return to, relink(tx, from)
}

// Place puts the line of a type covering an item on the draft into, or a
// new one when into is "", from the draft it is on (see MoveLines): to add
// sessions to an invoice, and the one way an item's line changes drafts.
// Refused while an issued document covers it.
func Place(tx *txn.Tx, src Source, t Type, into string) (*Document, error) {
	from, line, err := covering(tx, src, t)
	switch {
	case err != nil:
		return nil, err
	case from == nil:
		return nil, apperr.Refused(fmt.Sprintf("No %s covers it.", strings.ToLower(Types[t].Title)))
	case from.Issued():
		return nil, refuseIssued(from)
	case from.ID == into:
		return from, nil
	}
	return moveLines(tx, from.ID, into, []string{line.ID})
}

// Combine puts every line of the drafts ids[1:] on the draft ids[0], and
// they go: a client's sessions on one invoice, or receipts of one payment
// on one receipt.
func Combine(tx *txn.Tx, ids []string) (*Document, error) {
	var unique []string
	for _, id := range ids {
		if !slices.Contains(unique, id) {
			unique = append(unique, id)
		}
	}
	ids = unique
	if len(ids) < 2 {
		return nil, apperr.Invalid("Choose at least two drafts to put together.")
	}
	for _, id := range ids[1:] {
		d, err := Documents.Get(tx, id)
		if err != nil {
			return nil, err
		}
		if d.Issued() {
			return nil, refuseIssued(d)
		}
		if d.Draft == nil {
			return nil, notAtStep("Only drafts not issued yet are put together.")
		}
		var lineIDs []string
		for _, l := range d.Draft.Lines {
			lineIDs = append(lineIDs, l.ID)
		}
		if _, err := moveLines(tx, id, ids[0], lineIDs); err != nil {
			return nil, err
		}
	}
	return Documents.Get(tx, ids[0])
}
