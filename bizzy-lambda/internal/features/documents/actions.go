package documents

import (
	"fmt"
	"slices"
	"strings"
	"time"

	"bizzy-lambda/internal/features/clients"
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
// Legal). Lines keep what they cover and how it was paid (see paidAs), and
// an invoice line for an item stays: the item is charged until it is
// deleted or moved. A draft never issued keeps its lines in date order.
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
		line.For = nil
		if line.Source != nil {
			before, ok := was[*line.Source]
			if !ok {
				return nil, apperr.Invalid("Line %d refers to something this document doesn't cover.", i+1)
			}
			line.Typed = before.Typed || (d.Type == TypeInvoice && before.AmountCents != line.AmountCents)
			// Whom it is for is its item's, never the editor's.
			line.For = before.For
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
	paidAs(d.Type, d.Draft.Lines, next.Lines)
	if !d.Issued() {
		inDateOrder(next.Lines)
	}
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
// (see Fill), it is printed (see pdf.go), and it gets a share link.
func Issue(tx *txn.Tx, id string, checks ...Check) (*Document, error) {
	d, err := Documents.Get(tx, id)
	if err != nil {
		return nil, err
	}
	content, err := issuable(tx, d, checks)
	if err != nil {
		return nil, err
	}
	now := tx.Now().UTC()
	if d.Issued() {
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
	rev := &Revision{DocumentID: d.ID, Revision: *d.Revision, Number: d.Number, Content: content, IssuedAt: now}
	// The file itself is stored after the commit (see pdf.go).
	pdf, err := Render(PrintedRevision(d.Type, rev))
	if err != nil {
		return nil, err
	}
	rev.PDFSha256 = checksum(pdf)
	if err := Revisions.Add(tx, rev); err != nil {
		return nil, err
	}
	return d, relink(tx, d)
}

// CanIssue is the refusal for issuing a document (see issuable).
func CanIssue(tx *txn.Tx, d *Document, checks ...Check) error {
	_, err := issuable(tx, d, checks)
	return err
}

// issuable is what issuing a document would print, or the refusal to: it
// has a draft, other features' checks pass, and a revision corrects only
// what has no legal weight.
func issuable(tx *txn.Tx, d *Document, checks []Check) (Content, error) {
	if d.Draft == nil {
		return Content{}, notAtStep("There is nothing to issue.")
	}
	for _, check := range checks {
		if err := check(tx, d); err != nil {
			return Content{}, err
		}
	}
	content, err := filled(tx, d)
	if err != nil {
		return Content{}, err
	}
	if content.Date == "" {
		content.Date = tx.Now().In(tx.Location()).Format(time.DateOnly)
	}
	content.TotalCents = content.Total()
	if d.Issued() {
		if what := Legal(*d.Content, content); what != "" {
			return Content{}, stayIssued(d, what)
		}
	}
	return content, nil
}

// Revise opens an issued document for a correction. The issued revision
// stays the one that counts until the next is issued.
func Revise(tx *txn.Tx, id string) (*Document, error) {
	d, err := Documents.Get(tx, id)
	if err != nil {
		return nil, err
	}
	if err := CanRevise(d); err != nil {
		return nil, err
	}
	draft := clone(*d.Content)
	d.Draft = &draft
	return d, nil
}

// CanRevise is the refusal for revising a document: it is issued, and not
// being revised already.
func CanRevise(d *Document) error {
	switch {
	case d.Status != StatusIssued:
		return notAtStep("Only an issued document can be revised.")
	case d.Draft != nil:
		return notAtStep("Its next revision is being drafted already.")
	}
	return nil
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
	if err := CanDiscardDraft(d); err != nil {
		return nil, err
	}
	if d.Issued() {
		d.Draft = nil
		return d, nil
	}
	if err := Documents.Delete(tx, d.ID); err != nil {
		return nil, err
	}
	return nil, relink(tx, d)
}

// CanDiscardDraft is the refusal for discarding a draft: there is one, and
// a never-issued invoice goes only with what it charges.
func CanDiscardDraft(d *Document) error {
	switch {
	case d.Draft == nil:
		return notAtStep("There is no draft to discard.")
	case !d.Issued() && d.Type == TypeInvoice && slices.ContainsFunc(d.Draft.Lines, func(l Line) bool { return l.Source != nil }):
		return apperr.Refused("This draft charges what it covers, so it goes when they do: move its lines to another draft, or delete what it charges.")
	}
	return nil
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
	if err := CanCancel(d); err != nil {
		return nil, err
	}
	draft, err := newDraft(tx, d.Type, d.ClientID)
	if err != nil {
		return nil, err
	}
	for _, line := range d.Content.Lines {
		line.ID = tx.NewID()
		draft.Draft.Lines = append(draft.Draft.Lines, line)
	}
	inDateOrder(draft.Draft.Lines)
	draft.Draft.TotalCents = draft.Draft.Total()
	now := tx.Now().UTC()
	d.Status, d.Draft, d.CancelledAt, d.CancelReason = StatusCancelled, nil, &now, reason
	if err := relink(tx, d); err != nil {
		return nil, err
	}
	return d, relink(tx, draft)
}

// CanCancel is the refusal for cancelling a document: it is issued and not
// cancelled already.
func CanCancel(d *Document) error {
	if d.Status != StatusIssued {
		return notAtStep("Only an issued document can be cancelled; a draft goes with what it covers.")
	}
	return nil
}

// CanSend is the refusal for sending a document to its client: it is
// issued, and still counts.
func CanSend(d *Document) error {
	switch d.Status {
	case StatusDraft:
		return notAtStep("Issue it first: a draft isn't sent.")
	case StatusCancelled:
		return notAtStep("It was cancelled.")
	}
	return nil
}

// SetPayer bills a draft never issued to another client, its lines still
// for whom they were, its recipient filled again from them (see Fill). An
// invoice's items' payments, on receipts not issued, move to a receipt
// from them too, as they are now who pays.
func SetPayer(tx *txn.Tx, id, clientID string) (*Document, error) {
	d, err := Documents.Get(tx, id)
	if err != nil {
		return nil, err
	}
	if err := CanSetPayer(tx, d); err != nil {
		return nil, err
	}
	if _, err := clients.Active(tx, clientID); err != nil {
		return nil, err
	}
	if clientID == d.ClientID {
		return d, nil
	}
	if d.Type == TypeInvoice {
		into := map[Type]string{}
		for _, l := range d.Draft.Lines {
			if l.Source == nil {
				continue
			}
			r, line, err := Receipt(tx, *l.Source)
			if err != nil {
				return nil, err
			}
			if r != nil && r.ClientID == d.ClientID {
				if err := move(tx, r, *line, clientID, r.ForClient(*line), into); err != nil {
					return nil, err
				}
			}
		}
	}
	forIDs := make([]string, len(d.Draft.Lines))
	for i, l := range d.Draft.Lines {
		forIDs[i] = d.ForClient(l)
	}
	d.ClientID = clientID
	for i := range d.Draft.Lines {
		d.setFor(&d.Draft.Lines[i], forIDs[i])
	}
	d.Draft.Recipient = Recipient{}
	return d, relink(tx, d)
}

// CanSetPayer is the refusal for billing a document to another client: it
// is a draft never issued (who pays is what an issued one is for), and on
// an invoice, no issued receipt records a payment its old payer made for
// what it charges.
func CanSetPayer(tx *txn.Tx, d *Document) error {
	switch {
	case d.Issued():
		return stayIssued(d, "who pays")
	case d.Status != StatusDraft:
		return notAtStep("It was cancelled.")
	case d.Type != TypeInvoice:
		return nil
	}
	for _, l := range d.Draft.Lines {
		if l.Source == nil {
			continue
		}
		r, _, err := Receipt(tx, *l.Source)
		if err != nil {
			return err
		}
		if r != nil && r.Issued() && r.ClientID == d.ClientID {
			return apperr.Refused(fmt.Sprintf("%s records a payment for it from them. Cancel it first.", r.Number),
				apperr.Remedy{Action: "documents.cancel", Target: r.ID, Label: "Cancel " + r.Number})
		}
	}
	return nil
}

// CanMoveLines is the refusal for moving lines off a document, or putting
// it together with others: it is a draft never issued. Where they go may
// still refuse them (see MoveLines).
func CanMoveLines(d *Document) error {
	switch {
	case d.Issued():
		return refuseIssued(d)
	case d.Status != StatusDraft:
		return notAtStep("Lines move only between drafts not issued yet.")
	}
	return nil
}

// MoveLines moves lines from one draft to another of the same client and
// type, neither issued, or to a new one: to put a month of sessions on one
// invoice, or a package on its own. A receipt's lines keep their payments,
// so one receipt can record several. A draft left covering nothing goes,
// its other lines with the ones moved; a new one must cover something.
// The draft they go to keeps its lines in date order (see inDateOrder).
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
	if err := CanMoveLines(from); err != nil {
		return nil, err
	}
	var to *Document
	if toID == "" {
		if to, err = newDraft(tx, from.Type, from.ClientID); err != nil {
			return nil, err
		}
	} else if to, err = Documents.Get(tx, toID); err != nil {
		return nil, err
	}
	switch {
	case to.ID == from.ID:
		return nil, apperr.Invalid("Choose another draft.")
	case to.Status != StatusDraft:
		return nil, notAtStep("Lines move only between drafts not issued yet.")
	case combineKey(to) != combineKey(from):
		return nil, notAtStep("Lines move only between drafts of the same kind, for the same client.")
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
	inDateOrder(to.Draft.Lines)
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
// they go: a client's sessions on one invoice, or their payments on one
// receipt, in date order.
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
		if err := CanMoveLines(d); err != nil {
			return nil, err
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
