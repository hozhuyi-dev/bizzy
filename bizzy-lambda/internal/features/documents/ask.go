package documents

// The two WhatsApp messages the app sends, as far as the ledger decides
// them: asking to pay (what is owed, with an issued invoice's link) and
// sending issued documents for the client's records. A session, a package,
// an invoice and a client's ticked invoices all ask the same way; the app
// fills the user's templates in with what these return.

import (
	"cmp"
	"fmt"
	"slices"
	"strings"
	"time"

	"bizzy-lambda/internal/features/clients"
	"bizzy-lambda/internal/platform/txn"
)

// Owing is the invoice each owed item is owed on (see Link.Owed), read
// once for a list.
type Owing map[Source]string

// OwingOf is what is owed now.
func OwingOf(tx *txn.Tx) (Owing, error) {
	open, err := Links.Open(tx)
	owing := Owing{}
	for _, l := range open {
		owing[l.Source] = l.DocumentID
	}
	return owing, err
}

// owedOn is the lines of an invoice that are owed.
func (o Owing) owedOn(d *Document) []Line {
	c := d.Counting()
	if d.Type != TypeInvoice || c == nil {
		return nil
	}
	var out []Line
	for _, l := range c.Lines {
		if l.Source != nil && o[*l.Source] == d.ID {
			out = append(out, l)
		}
	}
	return out
}

// canAskOn is the refusal for asking to pay for a document: it is an
// invoice, and something on it is owed.
func (o Owing) canAskOn(d *Document) error {
	switch {
	case d.Type != TypeInvoice:
		return notAtStep("A receipt says it's paid; ask from the invoice.")
	case d.Status == StatusCancelled:
		return notAtStep("It was cancelled.")
	case len(o.owedOn(d)) == 0:
		return nothingOwed
	}
	return nil
}

var nothingOwed = notAtStep("Nothing on it is owed.")

// Ask is what a payment message asks for: what is owed, its total, and
// the reference to give the transfer.
type Ask struct {
	ClientID   string    `json:"clientId"`
	Lines      []AskLine `json:"lines"`
	TotalCents int64     `json:"totalCents"`
	// Ref is what the client types as the transfer's reference (see refOf).
	Ref string `json:"ref"`
}

// AskLine is one thing owed: an item not on an issued invoice, as its
// line says it, or an issued invoice as a whole, with its number and link.
type AskLine struct {
	Description string `json:"description"`
	Date        string `json:"date,omitempty"`
	AmountCents int64  `json:"amountCents"`
	Number      string `json:"number,omitempty"`
	Revision    *int   `json:"revision,omitempty"`
	ShareToken  string `json:"shareToken,omitempty"`
	kind        SourceKind
}

// AskFor is what is owed on items and on invoices, of one client. An item
// on an issued invoice is asked for as that invoice (what is owed on all
// of it), as the client pays the invoice; one on a draft as its own line.
func AskFor(tx *txn.Tx, items []Source, ids []string) (Ask, error) {
	owing, err := OwingOf(tx)
	if err != nil {
		return Ask{}, err
	}
	a := asking{owing: owing, asked: map[string]bool{}}
	for _, id := range ids {
		d, err := Documents.Get(tx, id)
		if err != nil {
			return Ask{}, err
		}
		a.document(d)
	}
	for _, src := range items {
		id, ok := owing[src]
		if !ok {
			continue
		}
		d, err := Documents.Get(tx, id)
		if err != nil {
			return Ask{}, err
		}
		if d.Issued() {
			a.document(d)
		} else {
			a.item(d, src)
		}
	}
	if len(a.clients) > 1 {
		return Ask{}, notAtStep("Ask one client at a time.")
	}
	return a.done(tx)
}

// CanAskToPay is the refusal for asking to pay for items and invoices:
// something on them is owed.
func CanAskToPay(tx *txn.Tx, items []Source, ids []string) error {
	a, err := AskFor(tx, items, ids)
	if err != nil {
		return err
	}
	return askable(a)
}

func askable(a Ask) error {
	if len(a.Lines) == 0 {
		return nothingOwed
	}
	return nil
}

// asking gathers what is owed, each item and invoice once.
type asking struct {
	owing   Owing
	asked   map[string]bool
	clients []string
	lines   []AskLine
}

func (a *asking) add(d *Document, l AskLine) {
	if !slices.Contains(a.clients, d.ClientID) {
		a.clients = append(a.clients, d.ClientID)
	}
	a.lines = append(a.lines, l)
}

func (a *asking) document(d *Document) {
	if a.asked[d.ID] || a.owing.canAskOn(d) != nil {
		return
	}
	a.asked[d.ID] = true
	owed := a.owing.owedOn(d)
	if !d.Issued() {
		for _, l := range owed {
			a.item(d, *l.Source)
		}
		return
	}
	var cents int64
	for _, l := range owed {
		cents += l.AmountCents
	}
	a.add(d, AskLine{
		Description: Types[d.Type].Title, Date: d.Content.Date, AmountCents: cents,
		Number: d.Number, Revision: d.Revision, ShareToken: d.ShareToken,
	})
}

func (a *asking) item(d *Document, src Source) {
	if a.asked[src.Key()] {
		return
	}
	a.asked[src.Key()] = true
	for _, l := range a.owing.owedOn(d) {
		if *l.Source == src {
			a.add(d, AskLine{Description: l.Description, Date: l.Date, AmountCents: l.AmountCents, kind: src.Kind})
		}
	}
}

func (a *asking) done(tx *txn.Tx) (Ask, error) {
	out := Ask{Lines: a.lines}
	if out.Lines == nil {
		out.Lines = []AskLine{}
	}
	if len(a.clients) == 0 {
		return out, nil
	}
	slices.SortStableFunc(out.Lines, func(x, y AskLine) int { return cmp.Compare(x.Date, y.Date) })
	for _, l := range out.Lines {
		out.TotalCents += l.AmountCents
	}
	out.ClientID = a.clients[0]
	client, err := clients.Clients.Get(tx, out.ClientID)
	if err != nil {
		return Ask{}, err
	}
	out.Ref = refOf(client.Name, out.Lines, tx.Now().In(tx.Location()).Format(time.DateOnly))
	return out, nil
}

// refLength is the most a Malaysian bank app takes as a transfer's
// reference.
const refLength = 20

// refOf is what the client types as the transfer's reference, so the
// payment is easy to match: the invoice's number when one issued invoice
// is asked for, else the client's first name and the day of the latest
// line ("AISYAH 05OCT", "AISYAH PKG 05OCT" for a package alone). Letters,
// digits and spaces only, at most 20, as bank apps take them.
func refOf(clientName string, lines []AskLine, today string) string {
	if len(lines) == 1 && lines[0].Number != "" {
		return truncate(refText(lines[0].Number), refLength)
	}
	var day string
	for _, l := range lines {
		day = max(day, l.Date)
	}
	suffix := " " + refDay(cmp.Or(day, today))
	if len(lines) == 1 && lines[0].kind == SourcePackage {
		suffix = " PKG" + suffix
	}
	first, _, _ := strings.Cut(strings.TrimSpace(clientName), " ")
	return strings.TrimSpace(truncate(refText(first), refLength-len(suffix)) + suffix)
}

// refText is s as a reference takes it: upper case letters and digits.
func refText(s string) string {
	return strings.Map(func(r rune) rune {
		switch {
		case r >= 'a' && r <= 'z':
			return r - 'a' + 'A'
		case r >= 'A' && r <= 'Z', r >= '0' && r <= '9':
			return r
		}
		return -1
	}, s)
}

func truncate(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}

// refDay is a YYYY-MM-DD day as a reference takes it: "05OCT".
func refDay(day string) string {
	t, err := time.Parse(time.DateOnly, day)
	if err != nil {
		return ""
	}
	return fmt.Sprintf("%02d%s", t.Day(), strings.ToUpper(t.Month().String()[:3]))
}

// Records are the issued documents covering items, to send for the
// client's records: their invoices, then their receipts.
func Records(tx *txn.Tx, items []Source) ([]*Document, error) {
	var out []*Document
	for _, t := range []Type{TypeInvoice, TypeReceipt} {
		for _, src := range items {
			d, _, err := covering(tx, src, t)
			if err != nil {
				return nil, err
			}
			if d != nil && CanSend(d) == nil && !slices.ContainsFunc(out, func(o *Document) bool { return o.ID == d.ID }) {
				out = append(out, d)
			}
		}
	}
	return out, nil
}

// CanSendRecords is the refusal for sending the documents covering items:
// one of them is issued.
func CanSendRecords(tx *txn.Tx, items []Source) error {
	docs, err := Records(tx, items)
	if err != nil {
		return err
	}
	return sendable(docs)
}

func sendable(docs []*Document) error {
	if len(docs) == 0 {
		return notAtStep("Nothing for it is issued. Issue its invoice or receipt first.")
	}
	return nil
}
