package documents

import (
	"encoding/json"
	"fmt"
	"slices"

	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/platform/txn"
)

// The ledger: what a session or package costs and what was received for
// it are the lines covering it in live documents. The features whose
// items they are change those lines only through the functions here, which
// refuse to change what an issued document says, and keep the Links.

// Link says which live document of a type covers an item: an index from
// the item to its document, kept by relink whenever a document's lines
// change, so finding an item's invoice is one read.
type Link struct {
	Source     Source `json:"source"`
	Type       Type   `json:"type"`
	DocumentID string `json:"documentId"`
	// Owed, on an invoice's link, says the item is charged something and
	// no receipt pays it: such links are listed as open (the to-do list's
	// "collect").
	Owed bool `json:"owed,omitempty"`
}

var Links = txn.Kind[Link]{
	Name: "DOCLINK", Gone: "Nothing covers it.",
	Doc:  txn.Doc{What: "Which live document of a type covers an item: <kind>:<id>#<type>.", Open: "an invoice's, while no receipt pays it: what is owed", Ref: "the document"},
	Meta: func(l *Link) txn.Meta { return txn.Meta{ID: linkID(l.Source, l.Type), Ref: l.DocumentID, Open: l.Owed} },
}

func linkID(src Source, t Type) string { return src.Key() + "#" + string(t) }

// covering is the live document of a type that covers an item, and its
// line; nil when there is none.
func covering(tx *txn.Tx, src Source, t Type) (*Document, *Line, error) {
	l, ok, err := Links.Find(tx, linkID(src, t))
	if err != nil || !ok {
		return nil, nil, err
	}
	d, ok, err := Documents.Find(tx, l.DocumentID)
	if err != nil || !ok {
		return nil, nil, err
	}
	c := d.Counting()
	if c == nil {
		return nil, nil, nil
	}
	i := slices.IndexFunc(c.Lines, func(line Line) bool { return line.Source != nil && *line.Source == src })
	if i < 0 {
		return nil, nil, nil
	}
	return d, &c.Lines[i], nil
}

// Invoice is the invoice charging an item, and its line; nil when none.
func Invoice(tx *txn.Tx, src Source) (*Document, *Line, error) {
	return covering(tx, src, TypeInvoice)
}

// Receipt is the receipt recording its payment, and its line; nil when
// none.
func Receipt(tx *txn.Tx, src Source) (*Document, *Line, error) {
	return covering(tx, src, TypeReceipt)
}

// Charged is what an item's invoice charges, and whether it has one.
func Charged(tx *txn.Tx, src Source) (int64, bool, error) {
	_, line, err := Invoice(tx, src)
	if err != nil || line == nil {
		return 0, false, err
	}
	return line.AmountCents, true, nil
}

// Paid is what a receipt says was received for an item.
type Paid struct {
	AmountCents int64  `json:"amountCents"`
	Method      Method `json:"method"`
	PaidOn      string `json:"paidOn"`
	ReceiptID   string `json:"receiptId"`
	// ReceiptNumber is set once the receipt is issued, as an invoice's is.
	ReceiptNumber string `json:"receiptNumber,omitempty"`
	Issued        bool   `json:"issued"`
}

// Received is what was received for an item; nil when nothing was.
func Received(tx *txn.Tx, src Source) (*Paid, error) {
	d, line, err := Receipt(tx, src)
	if err != nil || line == nil {
		return nil, err
	}
	p := &Paid{AmountCents: line.AmountCents, ReceiptID: d.ID, ReceiptNumber: d.Number, Issued: d.Issued()}
	if pay := d.Counting().Payment; pay != nil {
		p.Method, p.PaidOn = pay.Method, pay.PaidOn
	}
	return p, nil
}

// Owed lists every item charged something that no receipt pays.
func Owed(tx *txn.Tx) ([]Source, error) {
	open, err := Links.Open(tx)
	var out []Source
	for _, l := range open {
		out = append(out, l.Source)
	}
	return out, err
}

// Charge is what an item costs, as its invoice line says it.
type Charge struct {
	ClientID    string
	Source      Source
	Description string
	Date        string
	Cents       int64
	Typed       bool
	// Into is a never-issued draft invoice of the client to add the line
	// to when the item has none yet, so a session and the package bought
	// in it go on one invoice; "" starts a new one.
	Into string
}

// SetCharge makes an item's invoice line say what c does: its amount and
// whether it was typed, or a new line. Refused when that would change an
// issued invoice.
func SetCharge(tx *txn.Tx, c Charge) (*Document, error) {
	d, line, err := Invoice(tx, c.Source)
	if err != nil {
		return nil, err
	}
	defer tx.Later(func() error { return CheckPaid(tx, c.Source) })
	if d != nil {
		if d.Issued() {
			if line.AmountCents != c.Cents {
				return nil, refuseIssued(d)
			}
			return d, nil
		}
		line.AmountCents, line.Typed = c.Cents, c.Typed
		d.Draft.TotalCents = d.Draft.Total()
		return d, relink(tx, d)
	}
	if d, err = draftFor(tx, TypeInvoice, c.ClientID, c.Into); err != nil {
		return nil, err
	}
	src := c.Source
	d.Draft.Lines = append(d.Draft.Lines, Line{
		ID: tx.NewID(), Description: c.Description, Date: c.Date, AmountCents: c.Cents, Source: &src, Typed: c.Typed,
	})
	d.Draft.TotalCents = d.Draft.Total()
	return d, relink(tx, d)
}

// Uncharge takes an item off its invoice: it costs nothing any more (a
// package credit covers it). Refused while an issued invoice charges it.
func Uncharge(tx *txn.Tx, src Source) error {
	d, _, err := Invoice(tx, src)
	if err != nil || d == nil {
		return err
	}
	if d.Issued() {
		return refuseIssued(d)
	}
	tx.Later(func() error { return CheckPaid(tx, src) })
	_, err = takeLine(tx, d, src)
	return err
}

// Remove takes an item being deleted off its documents. What was received
// for it is never deleted with it: the payment is undone first, on
// purpose. what names the item in the refusal.
func Remove(tx *txn.Tx, src Source, what string) error {
	if r, _, err := Receipt(tx, src); err != nil {
		return err
	} else if r != nil {
		return apperr.Refused(fmt.Sprintf("Undo the payment first: deleting %s would lose the record of it.", what), undoPayment(src))
	}
	return Uncharge(tx, src)
}

// MoveToClient moves an item's lines to drafts of another client: to the
// drafts in into, by type, or new ones (recorded in into, so lines that
// move together share them). Refused while an issued document covers it.
func MoveToClient(tx *txn.Tx, src Source, clientID string, into map[Type]string) error {
	for _, t := range []Type{TypeInvoice, TypeReceipt} {
		d, _, err := covering(tx, src, t)
		if err != nil {
			return err
		}
		if d == nil || d.ClientID == clientID {
			continue
		}
		if d.Issued() {
			return refuseIssued(d)
		}
		payment := d.Draft.Payment
		line, err := takeLine(tx, d, src)
		if err != nil {
			return err
		}
		to, err := draftFor(tx, t, clientID, into[t])
		if err != nil {
			return err
		}
		if len(to.Draft.Lines) == 0 {
			setPayment(to.Draft, payment)
		}
		to.Draft.Lines = append(to.Draft.Lines, line)
		to.Draft.TotalCents = to.Draft.Total()
		into[t] = to.ID
		if err := relink(tx, to); err != nil {
			return err
		}
	}
	return nil
}

// Redate puts an item's lines on a new day: in place on a draft never
// issued; on an issued document in its next revision, drafted on top (a
// service date is a correction a revision may make).
func Redate(tx *txn.Tx, src Source, day string) error {
	for _, t := range []Type{TypeInvoice, TypeReceipt} {
		d, line, err := covering(tx, src, t)
		if err != nil {
			return err
		}
		switch {
		case d == nil:
		case !d.Issued():
			line.Date = day
		case line.Date == day && d.Draft == nil:
		default:
			if d.Draft == nil {
				draft := clone(*d.Content)
				d.Draft = &draft
			}
			for i := range d.Draft.Lines {
				if l := &d.Draft.Lines[i]; l.Source != nil && *l.Source == src {
					l.Date = day
				}
			}
		}
	}
	return nil
}

// Redescribe changes an item's lines on drafts never issued from was to
// now, where they still say was: a description the user wrote is theirs.
func Redescribe(tx *txn.Tx, src Source, was, now string) error {
	for _, t := range []Type{TypeInvoice, TypeReceipt} {
		d, line, err := covering(tx, src, t)
		if err != nil {
			return err
		}
		if d != nil && !d.Issued() && line.Description == was {
			line.Description = now
		}
	}
	return nil
}

// Paying is an item to record paid: what it is, whose, and its name in a
// refusal.
type Paying struct {
	Source   Source
	ClientID string
	What     string
}

// Pay records items paid in full, on a draft receipt per client, in place
// of any receipt line they had. Refused for one that owes nothing.
func Pay(tx *txn.Tx, items []Paying, p Payment) error {
	drafts := map[string]*Document{}
	for _, it := range items {
		_, charged, err := Invoice(tx, it.Source)
		if err != nil {
			return err
		}
		if charged == nil || charged.AmountCents == 0 {
			return apperr.Refused(fmt.Sprintf("Nothing is owed on %s.", it.What))
		}
		if err := Unpay(tx, it.Source); err != nil {
			return err
		}
		d, ok := drafts[it.ClientID]
		if !ok {
			if d, err = newDraft(tx, TypeReceipt, it.ClientID); err != nil {
				return err
			}
			setPayment(d.Draft, &p)
			drafts[it.ClientID] = d
		}
		src := it.Source
		d.Draft.Lines = append(d.Draft.Lines, Line{
			ID: tx.NewID(), Description: charged.Description, Date: charged.Date, AmountCents: charged.AmountCents, Source: &src,
		})
		d.Draft.TotalCents = d.Draft.Total()
		if err := relink(tx, d); err != nil {
			return err
		}
	}
	return nil
}

// Unpay undoes the payment recorded for an item, entered by mistake.
// Refused while an issued receipt records it.
func Unpay(tx *txn.Tx, src Source) error {
	d, _, err := Receipt(tx, src)
	if err != nil || d == nil {
		return err
	}
	if d.Issued() {
		return refuseIssued(d)
	}
	_, err = takeLine(tx, d, src)
	return err
}

// Repay makes what a receipt not issued yet says was received what the
// item's invoice now charges: the money collected or refunded with a
// change of fee.
func Repay(tx *txn.Tx, src Source) error {
	d, line, err := Receipt(tx, src)
	if err != nil || d == nil || d.Issued() {
		return err
	}
	cents, _, err := Charged(tx, src)
	if err != nil {
		return err
	}
	line.AmountCents = cents
	d.Draft.TotalCents = d.Draft.Total()
	return relink(tx, d)
}

// CheckPaid is the refusal for an item whose receipt doesn't say what its
// invoice charges: a payment is always in full, for what is owed.
func CheckPaid(tx *txn.Tx, src Source) error {
	_, received, err := Receipt(tx, src)
	if err != nil || received == nil {
		return err
	}
	cents, _, err := Charged(tx, src)
	switch {
	case err != nil:
		return err
	case cents == 0:
		return apperr.Refused(fmt.Sprintf("Nothing would be owed on %s, but a payment is recorded for it. Undo the payment first.", describe(*received)), undoPayment(src))
	case received.AmountCents != cents:
		return apperr.Refused(fmt.Sprintf("%s was received for %s, which would cost %s. Undo the payment first, or update it with the change.",
			Format(received.AmountCents), describe(*received), Format(cents)), undoPayment(src))
	}
	return nil
}

func describe(l Line) string {
	if l.Date == "" {
		return fmt.Sprintf("%q", l.Description)
	}
	return fmt.Sprintf("%q on %s", l.Description, l.Date)
}

func undoPayment(src Source) apperr.Remedy {
	return apperr.Remedy{
		Action: "payments.set", Target: src.Key(), Label: "Undo the payment",
		Request: map[string]any{"items": []map[string]any{{"kind": src.Kind, "id": src.ID}}},
	}
}

// CanChange is the refusal for changing what an item's documents of these
// types say: none of them is issued.
func CanChange(tx *txn.Tx, src Source, types ...Type) error {
	if src.ID == "" {
		return nil
	}
	for _, t := range types {
		d, _, err := covering(tx, src, t)
		if err != nil {
			return err
		}
		if d != nil && d.Issued() {
			return refuseIssued(d)
		}
	}
	return nil
}

// refuseIssued is the refusal for changing what an issued document says.
func refuseIssued(d *Document) error {
	return apperr.Refused(fmt.Sprintf("%s is issued, and this would change what it says. Cancel it first, then try again.", d.Number),
		apperr.Remedy{Action: "documents.cancel", Target: d.ID, Label: "Cancel " + d.Number})
}

// newDraft starts a document of a type for a client.
func newDraft(tx *txn.Tx, t Type, clientID string) (*Document, error) {
	d := &Document{
		ID: tx.NewID(), Type: t, Status: StatusDraft, ClientID: clientID,
		Draft: &Content{Lines: []Line{}}, CreatedAt: tx.Now().UTC(),
	}
	return d, Documents.Add(tx, d)
}

// draftFor is the never-issued draft into, if it is one of the type for
// the client, else a new one.
func draftFor(tx *txn.Tx, t Type, clientID, into string) (*Document, error) {
	if into != "" {
		d, ok, err := Documents.Find(tx, into)
		if err != nil {
			return nil, err
		}
		if ok && !d.Issued() && d.Status == StatusDraft && d.Type == t && d.ClientID == clientID {
			return d, nil
		}
	}
	return newDraft(tx, t, clientID)
}

// takeLine takes an item's line off a document not issued, deleting a
// draft left empty.
func takeLine(tx *txn.Tx, d *Document, src Source) (Line, error) {
	var taken Line
	d.Draft.Lines = slices.DeleteFunc(d.Draft.Lines, func(l Line) bool {
		if l.Source != nil && *l.Source == src {
			taken = l
			return true
		}
		return false
	})
	d.Draft.TotalCents = d.Draft.Total()
	if len(d.Draft.Lines) == 0 {
		if err := Documents.Delete(tx, d.ID); err != nil {
			return taken, err
		}
	}
	return taken, relink(tx, d)
}

func setPayment(c *Content, p *Payment) {
	c.Payment, c.PaidBy = p, ""
	if p != nil {
		c.PaidBy = MethodLabels[p.Method]
	}
}

// relink points the Links of the items a document counts for at it, drops
// those of the items it no longer counts for, and settles what each owes.
// Every change to a document's lines ends with it.
func relink(tx *txn.Tx, d *Document) error {
	want := map[Source]bool{}
	if _, kept, err := Documents.Find(tx, d.ID); err != nil {
		return err
	} else if c := d.Counting(); kept && c != nil {
		for _, l := range c.Lines {
			if l.Source != nil {
				want[*l.Source] = true
			}
		}
	}
	have, err := Links.WithRef(tx, d.ID)
	if err != nil {
		return err
	}
	var touched []Source
	for _, l := range have {
		if !want[l.Source] {
			touched = append(touched, l.Source)
			if err := Links.Delete(tx, linkID(l.Source, l.Type)); err != nil {
				return err
			}
		}
	}
	for _, src := range sortedSources(want) {
		touched = append(touched, src)
		l, ok, err := Links.Find(tx, linkID(src, d.Type))
		switch {
		case err != nil:
			return err
		case ok:
			l.DocumentID = d.ID
		default:
			if err := Links.Add(tx, &Link{Source: src, Type: d.Type, DocumentID: d.ID}); err != nil {
				return err
			}
		}
	}
	for _, src := range touched {
		if err := settle(tx, src); err != nil {
			return err
		}
	}
	return nil
}

// settle marks an item's invoice link owed, or not.
func settle(tx *txn.Tx, src Source) error {
	l, ok, err := Links.Find(tx, linkID(src, TypeInvoice))
	if err != nil || !ok {
		return err
	}
	owed, err := owes(tx, src)
	l.Owed = owed
	return err
}

// owes reports whether an item is charged something no receipt pays.
func owes(tx *txn.Tx, src Source) (bool, error) {
	cents, _, err := Charged(tx, src)
	if err != nil || cents == 0 {
		return false, err
	}
	_, paid, err := Links.Find(tx, linkID(src, TypeReceipt))
	return !paid, err
}

func sortedSources(set map[Source]bool) []Source {
	out := make([]Source, 0, len(set))
	for s := range set {
		out = append(out, s)
	}
	slices.SortFunc(out, func(a, b Source) int {
		switch {
		case a.Key() < b.Key():
			return -1
		case a.Key() > b.Key():
			return 1
		}
		return 0
	})
	return out
}

// clone is a deep copy of content.
func clone(c Content) Content {
	b, _ := json.Marshal(c)
	var out Content
	_ = json.Unmarshal(b, &out)
	return out
}
