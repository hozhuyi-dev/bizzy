// Package pdflayout lays out PDFs from blocks, as QuestPDF does: a page is
// a tree of blocks (text, rows, columns, tables), each of which measures
// its height at a width and then draws itself there. A Document flows its
// body down its pages, breaking only between blocks: a Flow between its
// children, a Table between its rows (its header on top of every page it
// runs on). Nothing smaller breaks, which is all an invoice or a receipt
// needs.
//
// It draws with fpdf, in points, in the PDF core fonts (Helvetica), which
// every reader has, so nothing is embedded. Text is written in Windows-1252:
// Latin names only. The same Document always makes the same bytes (see
// Info.At), so a hash of the file identifies what was printed.
package pdflayout

import (
	"strings"

	"codeberg.org/go-pdf/fpdf"
)

// Block is the smallest unit of a layout.
type Block interface {
	// Height is how tall it is, drawn at width.
	Height(c *Canvas, width float64) float64
	// Draw draws it at width, its top left corner at x, y.
	Draw(c *Canvas, x, y, width float64)
}

// breakable is a block a page may break inside: between its parts, each
// drawn whole; no parts keeps it whole. repeat, if any, is drawn on top of
// every page after the first it runs on.
type breakable interface {
	Block
	parts(c *Canvas, width float64) (parts []Block, repeat Block)
}

// Canvas is what blocks measure and draw with.
type Canvas struct {
	pdf *fpdf.Fpdf
	// encode writes UTF-8 as the core fonts' Windows-1252.
	encode func(string) string
}

func newCanvas(pdf *fpdf.Fpdf) *Canvas {
	// A cell's text starts at its edge: blocks pad themselves.
	pdf.SetCellMargin(0)
	pdf.SetAutoPageBreak(false, 0)
	return &Canvas{pdf: pdf, encode: pdf.UnicodeTranslatorFromDescriptor("")}
}

// Color is an RGB color, 0 to 255 each.
type Color struct{ R, G, B int }

// Gray is a shade of gray, 0 (black) to 255 (white).
func Gray(v int) Color { return Color{v, v, v} }

// Black is the color of text unless a style says otherwise.
var Black = Color{}

// Edges are space around a block, in points.
type Edges struct{ Top, Right, Bottom, Left float64 }

// All is the same space on every side.
func All(v float64) Edges { return Edges{v, v, v, v} }

// Sides is vertical space above and below, horizontal space either side.
func Sides(vertical, horizontal float64) Edges {
	return Edges{vertical, horizontal, vertical, horizontal}
}

// Style is how text is set.
type Style struct {
	// Size is in points; 0 is 10.
	Size   float64
	Bold   bool
	Italic bool
	Color  Color
	// Leading is the line height as a multiple of Size; 0 is 1.35.
	Leading float64
}

func (s Style) size() float64 {
	if s.Size == 0 {
		return 10
	}
	return s.Size
}

func (s Style) lineHeight() float64 {
	if s.Leading == 0 {
		return s.size() * 1.35
	}
	return s.size() * s.Leading
}

func (c *Canvas) setFont(s Style) {
	var style strings.Builder
	if s.Bold {
		style.WriteByte('B')
	}
	if s.Italic {
		style.WriteByte('I')
	}
	c.pdf.SetFont("Helvetica", style.String(), s.size())
	c.pdf.SetTextColor(s.Color.R, s.Color.G, s.Color.B)
}
