package documents

import (
	"fmt"
	"strings"
	"time"

	"bizzy-lambda/internal/platform/pdflayout"
)

// Printed is a document as it prints.
type Printed struct {
	Type Type
	// Number and Revision label it; Number is "" for a draft never issued.
	Number   string
	Revision int
	Content  Content
	// Draft prints DRAFT across every page.
	Draft bool
	// At is when it was printed, as the file says: an issued revision's
	// issue time, so its PDF comes out the same every time.
	At time.Time
}

// PrintedRevision is an issued revision as it prints.
func PrintedRevision(t Type, r *Revision) Printed {
	return Printed{Type: t, Number: r.Number, Revision: r.Revision, Content: r.Content, At: r.IssuedAt}
}

// label is its number as printed, or what it is before it has one.
func (p Printed) label() string {
	if p.Number == "" {
		return "Draft"
	}
	return Label(p.Number, p.Revision)
}

// FileName is what its PDF is saved as: "RCP260042-00 Jane Tan.pdf".
func (p Printed) FileName() string {
	return strings.TrimSpace(p.label()+" "+p.Content.Recipient.Name) + ".pdf"
}

// info is what its PDF says about itself.
func (p Printed) info() pdflayout.Info {
	return pdflayout.Info{Title: Types[p.Type].Title + " " + p.label(), Author: p.Content.Issuer.Name, At: p.At}
}

// The palette and type sizes, in points.
var (
	ink   = pdflayout.Gray(26)
	muted = pdflayout.Gray(110)
	faint = pdflayout.Gray(222)
	shade = pdflayout.Gray(243)
	red   = pdflayout.Color{R: 213, G: 0, B: 0}
)

const (
	bodySize  = 9.5
	smallSize = 8
	labelSize = 7.5
	// Widths of the lines' date and amount columns, and the gap between
	// columns.
	dateWidth   = 78
	amountWidth = 92
	columnGap   = 10
)

// Render prints a document as a PDF: the same Printed always makes the same
// bytes.
func Render(p Printed) ([]byte, error) {
	spec := Types[p.Type]
	c := p.Content
	doc := pdflayout.Document{
		Info:      p.info(),
		Margins:   pdflayout.Edges{Top: 48, Right: 48, Bottom: 32, Left: 48},
		FooterGap: 20,
		Body: pdflayout.Flow(
			header(p, spec),
			pdflayout.Rule(0.75, faint),
			recipient(spec, c.Recipient),
			lines(c.Lines),
			totals(spec, c.TotalCents),
			section("Notes", text(c.Notes)),
			paymentDetails(p, spec),
		).Gap(20),
		Footer: func(page int) pdflayout.Block {
			note := fmt.Sprintf("This is a computer-generated %s. No signature is required.", strings.ToLower(spec.Title))
			return pdflayout.Column(
				pdflayout.Rule(0.5, faint),
				pdflayout.Row(
					pdflayout.Grow(small(note)),
					pdflayout.Fixed(80, small(fmt.Sprintf("Page %d of %s", page, pdflayout.PageCount)).Right()),
				),
			).Gap(6)
		},
	}
	if p.Draft {
		doc.Watermark = &pdflayout.Watermark{Text: "DRAFT", Color: muted}
	}
	return doc.Render()
}

// Cancelled is the watermark stamped over a cancelled document's PDF.
var Cancelled = pdflayout.Watermark{Text: "CANCELLED", Color: red}

// header is the business on the left; what the document is, its number
// and date on the right.
func header(p Printed, spec TypeSpec) pdflayout.Block {
	i := p.Content.Issuer
	business := pdflayout.Column(
		pdflayout.Column(
			pdflayout.Text(i.Name).Size(14).Bold().Color(ink).Leading(1.2),
			small(i.RegistrationNo),
		).Gap(2),
		text(i.Address),
		text(joinNonEmpty(" · ", i.Phone, i.Email)),
	).Gap(6)
	meta := func(label, value string) pdflayout.Block {
		return pdflayout.Row(
			pdflayout.Grow(text(label).Color(muted).Right()),
			pdflayout.Fixed(96, text(value).Bold().Right()),
		).Gap(8)
	}
	title := pdflayout.Column(
		pdflayout.Text(spec.Title).Caps().Size(22).Bold().Color(ink).Leading(1.1).Right(),
		pdflayout.Column(meta("No.", p.label()), meta("Date", printedDate(p.Content.Date))).Gap(2),
	).Gap(10)
	return pdflayout.Row(pdflayout.Grow(business), pdflayout.Fixed(200, title)).Gap(24)
}

// recipient is who it is for: their name, and IC or passport number.
func recipient(spec TypeSpec, r Recipient) pdflayout.Block {
	var id pdflayout.Block = pdflayout.Space(0)
	if r.IDNo != "" {
		id = text("IC / Passport No. " + r.IDNo)
	}
	return section(spec.RecipientLabel, pdflayout.Column(
		pdflayout.Text(r.Name).Size(10.5).Bold().Color(ink),
		id,
	).Gap(2))
}

// lines are the table of what it covers, which a page may break between
// rows.
func lines(all []Line) pdflayout.Block {
	row := func(date, description, amount pdflayout.TextBlock) pdflayout.Block {
		return pdflayout.Pad(pdflayout.Row(
			pdflayout.Fixed(dateWidth, date),
			pdflayout.Grow(description),
			pdflayout.Fixed(amountWidth, amount.Right()),
		).Gap(columnGap), pdflayout.Sides(0, 8))
	}
	head := pdflayout.Fill(shade, pdflayout.Pad(row(label("Date"), label("Description"), label("Amount (RM)")), pdflayout.Sides(6, 0)))
	rows := make([]pdflayout.Block, len(all))
	for n, l := range all {
		rows[n] = pdflayout.Underline(
			pdflayout.Pad(row(text(printedDate(l.Date)), text(l.Description), text(printedAmount(l.AmountCents))), pdflayout.Sides(7, 0)),
			0.5, faint)
	}
	return pdflayout.Table(head, rows...)
}

// totals are the total on the right, and the amount in words under it.
func totals(spec TypeSpec, cents int64) pdflayout.Block {
	total := pdflayout.Row(
		pdflayout.Grow(pdflayout.Space(0)),
		pdflayout.Fixed(260, pdflayout.Pad(pdflayout.Row(
			pdflayout.Grow(pdflayout.Pad(label(spec.TotalLabel).Color(ink).Right(), pdflayout.Edges{Top: 4})),
			pdflayout.Fixed(amountWidth+8, pdflayout.Text("RM "+printedAmount(cents)).Size(13).Bold().Color(ink).Right()),
		).Gap(columnGap), pdflayout.Edges{Right: 8})),
	)
	return pdflayout.Column(total, text(InWords(cents)).Italic()).Gap(10)
}

// paymentDetails are where to pay an invoice: the bank account, and the
// number to quote. Nothing for a receipt, or without a bank account.
func paymentDetails(p Printed, spec TypeSpec) pdflayout.Block {
	i := p.Content.Issuer
	if !spec.AsksPayment || i.BankName+i.AccountName+i.AccountNo == "" {
		return pdflayout.Space(0)
	}
	field := func(name, value string) pdflayout.Block {
		if value == "" {
			return pdflayout.Space(0)
		}
		return pdflayout.Row(pdflayout.Fixed(80, text(name).Color(muted)), pdflayout.Grow(text(value).Bold()))
	}
	var quote pdflayout.Block = pdflayout.Space(0)
	if p.Number != "" {
		quote = pdflayout.Pad(text(fmt.Sprintf("Please quote %s with your payment.", p.label())).Color(muted), pdflayout.Edges{Top: 4})
	}
	return section("Payment details", pdflayout.Column(
		field("Bank", i.BankName), field("Account name", i.AccountName), field("Account no.", i.AccountNo), quote,
	).Gap(2))
}

// section is a small capital label over what it heads; nothing when what
// it heads is empty.
func section(name string, body pdflayout.Block) pdflayout.Block {
	return emptyIf(body, pdflayout.Column(label(name), body).Gap(5))
}

// emptyIf is b, unless body takes no room.
func emptyIf(body, b pdflayout.Block) pdflayout.Block { return nonEmpty{body: body, block: b} }

type nonEmpty struct{ body, block pdflayout.Block }

func (n nonEmpty) Height(c *pdflayout.Canvas, width float64) float64 {
	if n.body.Height(c, width) == 0 {
		return 0
	}
	return n.block.Height(c, width)
}

func (n nonEmpty) Draw(c *pdflayout.Canvas, x, y, width float64) {
	if n.body.Height(c, width) > 0 {
		n.block.Draw(c, x, y, width)
	}
}

func text(s string) pdflayout.TextBlock {
	return pdflayout.Text(s).Size(bodySize).Color(ink)
}

func small(s string) pdflayout.TextBlock {
	return pdflayout.Text(s).Size(smallSize).Color(muted)
}

func label(s string) pdflayout.TextBlock {
	return pdflayout.Text(s).Caps().Size(labelSize).Bold().Color(muted)
}

// printedDate writes a YYYY-MM-DD day as "22 Oct 2026"; "" stays "".
func printedDate(day string) string {
	t, err := time.Parse(time.DateOnly, day)
	if err != nil {
		return day
	}
	return t.Format("2 Jan 2006")
}

// printedAmount writes cents with thousands separated: "1,250.00".
func printedAmount(cents int64) string {
	sign := ""
	if cents < 0 {
		sign, cents = "-", -cents
	}
	whole := fmt.Sprint(cents / 100)
	for i := len(whole) - 3; i > 0; i -= 3 {
		whole = whole[:i] + "," + whole[i:]
	}
	return fmt.Sprintf("%s%s.%02d", sign, whole, cents%100)
}

func joinNonEmpty(sep string, parts ...string) string {
	var kept []string
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			kept = append(kept, p)
		}
	}
	return strings.Join(kept, sep)
}
