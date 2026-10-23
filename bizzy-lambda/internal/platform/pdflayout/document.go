package pdflayout

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"time"

	"codeberg.org/go-pdf/fpdf"
	"codeberg.org/go-pdf/fpdf/contrib/gofpdi"
)

// PageCount is replaced by the number of pages once they are all laid
// out: a footer writes "Page 2 of " + PageCount.
const PageCount = "{nb}"

// Info is what a PDF says about itself.
type Info struct {
	Title, Author string
	// At is when it was made, as the file says. The file holds no other
	// clock, so the same At and blocks make the same bytes; it must be
	// set.
	At time.Time
}

// Watermark is a word across every page, under what is printed: DRAFT.
type Watermark struct {
	Text  string
	Color Color
}

// Document is A4 pages.
type Document struct {
	Info    Info
	Margins Edges
	// Body flows down the pages (see the package doc).
	Body Block
	// Footer, if any, is drawn at the foot of every page, inside the
	// bottom margin's edge, FooterGap below the body.
	Footer    func(page int) Block
	FooterGap float64
	Watermark *Watermark
}

// Render lays the document out and writes the PDF.
func (d Document) Render() ([]byte, error) {
	if d.Info.At.IsZero() {
		return nil, errors.New("pdflayout: Info.At is not set, so the PDF would differ every time")
	}
	pdf := newPDF(d.Info)
	f := &flow{c: newCanvas(pdf), d: d}
	pageW, pageH := pdf.GetPageSize()
	f.x, f.width, f.top = d.Margins.Left, pageW-d.Margins.Left-d.Margins.Right, d.Margins.Top
	f.bottom = pageH - d.Margins.Bottom
	if d.Footer != nil {
		f.bottom -= d.Footer(1).Height(f.c, f.width) + d.FooterGap
	}
	f.newPage()
	f.place(d.Body)
	return output(pdf)
}

func newPDF(info Info) *fpdf.Fpdf {
	pdf := fpdf.New("P", "pt", "A4", "")
	pdf.SetCatalogSort(true)
	pdf.SetCreationDate(info.At)
	pdf.SetModificationDate(info.At)
	pdf.SetTitle(info.Title, true)
	pdf.SetAuthor(info.Author, true)
	pdf.SetCreator("bizzy", true)
	pdf.AliasNbPages(PageCount)
	return pdf
}

func output(pdf *fpdf.Fpdf) ([]byte, error) {
	var b bytes.Buffer
	if err := pdf.Output(&b); err != nil {
		return nil, fmt.Errorf("pdflayout: %w", err)
	}
	return b.Bytes(), nil
}

// flow places blocks down the pages.
type flow struct {
	c *Canvas
	d Document
	// The body's box on every page.
	x, width, top, bottom float64
	// y is where the next block goes; pageTop where the page's body
	// started, under any repeated headers.
	y, pageTop float64
	page       int
	// repeats are the headers of the tables running on, outermost first.
	repeats []Block
}

// slack forgives rounding when a block exactly fills the page.
const slack = 0.01

func (f *flow) atTop() bool { return f.y <= f.pageTop+slack }

func (f *flow) newPage() {
	f.c.pdf.AddPage()
	f.page++
	pageW, pageH := f.c.pdf.GetPageSize()
	if f.d.Watermark != nil {
		f.d.Watermark.draw(f.c.pdf, pageW, pageH)
	}
	if f.d.Footer != nil {
		footer := f.d.Footer(f.page)
		footer.Draw(f.c, f.x, pageH-f.d.Margins.Bottom-footer.Height(f.c, f.width), f.width)
	}
	f.y = f.top
	for _, r := range f.repeats {
		r.Draw(f.c, f.x, f.y, f.width)
		f.y += r.Height(f.c, f.width)
	}
	f.pageTop = f.y
}

// place draws a block where it fits: here, broken between its parts if it
// may break, or whole on a new page. One taller than a page is drawn
// whole anyway, running off its foot.
func (f *flow) place(b Block) {
	if g, ok := b.(gap); ok {
		if !f.atTop() {
			f.y += float64(g)
		}
		return
	}
	h := b.Height(f.c, f.width)
	if h == 0 {
		return
	}
	if f.y+h <= f.bottom+slack {
		b.Draw(f.c, f.x, f.y, f.width)
		f.y += h
		return
	}
	if br, ok := b.(breakable); ok {
		if parts, repeat := br.parts(f.c, f.width); parts != nil {
			for i, p := range parts {
				f.place(p)
				// After the first part, which holds the header itself.
				if i == 0 && repeat != nil {
					f.repeats = append(f.repeats, repeat)
					defer func() { f.repeats = f.repeats[:len(f.repeats)-1] }()
				}
			}
			return
		}
	}
	if !f.atTop() {
		f.newPage()
	}
	b.Draw(f.c, f.x, f.y, f.width)
	f.y += h
}

// watermarkSize is the watermark's font size, in points.
const watermarkSize = 88

func (w Watermark) draw(pdf *fpdf.Fpdf, pageW, pageH float64) {
	pdf.SetFont("Helvetica", "B", watermarkSize)
	pdf.SetTextColor(w.Color.R, w.Color.G, w.Color.B)
	pdf.SetAlpha(0.15, "Normal")
	cx, cy := pageW/2, pageH/2
	pdf.TransformBegin()
	pdf.TransformRotate(30, cx, cy)
	pdf.Text(cx-pdf.GetStringWidth(w.Text)/2, cy+watermarkSize*0.35, w.Text)
	pdf.TransformEnd()
	pdf.SetAlpha(1, "Normal")
}

// Stamp draws a watermark over every page of a PDF already made, which
// otherwise stays as it was: CANCELLED over an issued document.
func Stamp(file []byte, info Info, w Watermark) (out []byte, err error) {
	// The importer panics on a file it can't read.
	defer func() {
		if r := recover(); r != nil {
			out, err = nil, fmt.Errorf("pdflayout: stamp: %v", r)
		}
	}()
	pdf := newPDF(info)
	imp := gofpdi.NewImporter()
	var rs io.ReadSeeker = bytes.NewReader(file)
	tpl := imp.ImportPageFromStream(pdf, &rs, 1, "/MediaBox")
	pages := len(imp.GetPageSizes())
	for page := 1; page <= pages; page++ {
		if page > 1 {
			tpl = imp.ImportPageFromStream(pdf, &rs, page, "/MediaBox")
		}
		pdf.AddPage()
		pageW, pageH := pdf.GetPageSize()
		imp.UseImportedTemplate(pdf, tpl, 0, 0, pageW, pageH)
		w.draw(pdf, pageW, pageH)
	}
	return output(pdf)
}
