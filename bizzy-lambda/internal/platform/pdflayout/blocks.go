package pdflayout

import "strings"

// TextBlock is text, wrapped to its width at spaces, with a line per "\n".
// Empty text takes no room, so an optional field left blank leaves no gap.
type TextBlock struct {
	text  string
	style Style
	// align is fpdf's: "L", "C" or "R".
	align string
}

// Text is text set in 10-point black Helvetica, left aligned.
func Text(text string) TextBlock { return TextBlock{text: text, align: "L"} }

func (t TextBlock) Size(points float64) TextBlock      { t.style.Size = points; return t }
func (t TextBlock) Bold() TextBlock                    { t.style.Bold = true; return t }
func (t TextBlock) Italic() TextBlock                  { t.style.Italic = true; return t }
func (t TextBlock) Color(c Color) TextBlock            { t.style.Color = c; return t }
func (t TextBlock) Leading(multiple float64) TextBlock { t.style.Leading = multiple; return t }
func (t TextBlock) Style(s Style) TextBlock            { t.style = s; return t }
func (t TextBlock) Right() TextBlock                   { t.align = "R"; return t }
func (t TextBlock) Center() TextBlock                  { t.align = "C"; return t }

// Caps sets it in capitals.
func (t TextBlock) Caps() TextBlock { t.text = strings.ToUpper(t.text); return t }

// lines are the text as it wraps at width, in the font's encoding.
func (t TextBlock) lines(c *Canvas, width float64) []string {
	if strings.TrimSpace(t.text) == "" {
		return nil
	}
	c.setFont(t.style)
	var out []string
	for _, paragraph := range strings.Split(strings.ReplaceAll(t.text, "\r", ""), "\n") {
		wrapped := c.pdf.SplitLines([]byte(c.encode(paragraph)), width)
		if len(wrapped) == 0 {
			out = append(out, "")
		}
		for _, line := range wrapped {
			out = append(out, string(line))
		}
	}
	return out
}

func (t TextBlock) Height(c *Canvas, width float64) float64 {
	return float64(len(t.lines(c, width))) * t.style.lineHeight()
}

func (t TextBlock) Draw(c *Canvas, x, y, width float64) {
	lh := t.style.lineHeight()
	for i, line := range t.lines(c, width) {
		c.pdf.SetXY(x, y+float64(i)*lh)
		c.pdf.CellFormat(width, lh, line, "", 0, t.align, false, 0, "")
	}
}

// ColumnBlock is blocks one under another, a gap between those that take
// room.
type ColumnBlock struct {
	blocks    []Block
	gap       float64
	breakable bool
}

// Column is blocks one under another, drawn on one page.
func Column(blocks ...Block) ColumnBlock { return ColumnBlock{blocks: blocks} }

// Flow is blocks one under another that a page may break between: a
// page's body.
func Flow(blocks ...Block) ColumnBlock { return ColumnBlock{blocks: blocks, breakable: true} }

// Gap is the space between its blocks.
func (col ColumnBlock) Gap(points float64) ColumnBlock { col.gap = points; return col }

// shown are its blocks that take room at width, with their heights.
func (col ColumnBlock) shown(c *Canvas, width float64) ([]Block, []float64) {
	var blocks []Block
	var heights []float64
	for _, b := range col.blocks {
		if h := b.Height(c, width); h > 0 {
			blocks, heights = append(blocks, b), append(heights, h)
		}
	}
	return blocks, heights
}

func (col ColumnBlock) Height(c *Canvas, width float64) float64 {
	_, heights := col.shown(c, width)
	total := 0.0
	for i, h := range heights {
		if i > 0 {
			total += col.gap
		}
		total += h
	}
	return total
}

func (col ColumnBlock) Draw(c *Canvas, x, y, width float64) {
	blocks, heights := col.shown(c, width)
	for i, b := range blocks {
		if i > 0 {
			y += col.gap
		}
		b.Draw(c, x, y, width)
		y += heights[i]
	}
}

// parts are a Flow's blocks, with gaps a page's top drops; a Column has
// none, so it stays whole.
func (col ColumnBlock) parts(c *Canvas, width float64) ([]Block, Block) {
	if !col.breakable {
		return nil, nil
	}
	blocks, _ := col.shown(c, width)
	var parts []Block
	for i, b := range blocks {
		if i > 0 && col.gap > 0 {
			parts = append(parts, gap(col.gap))
		}
		parts = append(parts, b)
	}
	return parts, nil
}

// gap is space between parts of a Flow, dropped at the top of a page.
type gap float64

func (g gap) Height(*Canvas, float64) float64       { return float64(g) }
func (gap) Draw(*Canvas, float64, float64, float64) {}

// Cell is a block in a Row, with its width.
type Cell struct {
	width float64
	block Block
}

// Fixed is a cell of a fixed width, in points.
func Fixed(width float64, b Block) Cell { return Cell{width: width, block: b} }

// Grow is a cell sharing the row's width that fixed cells leave.
func Grow(b Block) Cell { return Cell{block: b} }

// RowBlock is cells side by side, top aligned; as tall as its tallest.
type RowBlock struct {
	cells []Cell
	gap   float64
}

func Row(cells ...Cell) RowBlock { return RowBlock{cells: cells} }

// Gap is the space between its cells.
func (r RowBlock) Gap(points float64) RowBlock { r.gap = points; return r }

func (r RowBlock) widths(width float64) []float64 {
	fixed, growing := r.gap*float64(max(len(r.cells)-1, 0)), 0
	for _, cell := range r.cells {
		if cell.width > 0 {
			fixed += cell.width
		} else {
			growing++
		}
	}
	out := make([]float64, len(r.cells))
	for i, cell := range r.cells {
		out[i] = cell.width
		if cell.width == 0 {
			out[i] = max(width-fixed, 0) / float64(growing)
		}
	}
	return out
}

func (r RowBlock) Height(c *Canvas, width float64) float64 {
	tallest := 0.0
	for i, w := range r.widths(width) {
		tallest = max(tallest, r.cells[i].block.Height(c, w))
	}
	return tallest
}

func (r RowBlock) Draw(c *Canvas, x, y, width float64) {
	for i, w := range r.widths(width) {
		r.cells[i].block.Draw(c, x, y, w)
		x += w + r.gap
	}
}

// PaddingBlock is a block with space around it.
type PaddingBlock struct {
	block Block
	edges Edges
}

func Pad(b Block, e Edges) PaddingBlock { return PaddingBlock{block: b, edges: e} }

func (p PaddingBlock) inner(width float64) float64 {
	return max(width-p.edges.Left-p.edges.Right, 0)
}

func (p PaddingBlock) Height(c *Canvas, width float64) float64 {
	h := p.block.Height(c, p.inner(width))
	if h == 0 {
		return 0
	}
	return p.edges.Top + h + p.edges.Bottom
}

func (p PaddingBlock) Draw(c *Canvas, x, y, width float64) {
	p.block.Draw(c, x+p.edges.Left, y+p.edges.Top, p.inner(width))
}

// FillBlock is a block on a colored background.
type FillBlock struct {
	block Block
	color Color
}

func Fill(color Color, b Block) FillBlock { return FillBlock{block: b, color: color} }

func (f FillBlock) Height(c *Canvas, width float64) float64 { return f.block.Height(c, width) }

func (f FillBlock) Draw(c *Canvas, x, y, width float64) {
	c.pdf.SetFillColor(f.color.R, f.color.G, f.color.B)
	c.pdf.Rect(x, y, width, f.Height(c, width), "F")
	f.block.Draw(c, x, y, width)
}

// RuleBlock is a horizontal line across its width.
type RuleBlock struct {
	thickness float64
	color     Color
}

func Rule(thickness float64, color Color) RuleBlock { return RuleBlock{thickness, color} }

func (r RuleBlock) Height(*Canvas, float64) float64 { return r.thickness }

func (r RuleBlock) Draw(c *Canvas, x, y, width float64) {
	c.pdf.SetDrawColor(r.color.R, r.color.G, r.color.B)
	c.pdf.SetLineWidth(r.thickness)
	mid := y + r.thickness/2
	c.pdf.Line(x, mid, x+width, mid)
}

// Underline is a block with a rule right under it.
func Underline(b Block, thickness float64, color Color) Block {
	return Column(b, Rule(thickness, color))
}

// SpaceBlock is empty space.
type SpaceBlock float64

// Space is empty space of a height, in points.
func Space(points float64) SpaceBlock { return SpaceBlock(points) }

func (s SpaceBlock) Height(*Canvas, float64) float64       { return float64(s) }
func (SpaceBlock) Draw(*Canvas, float64, float64, float64) {}

// TableBlock is a header and rows. A page breaks it between rows only,
// draws the header again on top of every page it runs on, and never
// leaves the header alone at the foot of a page.
type TableBlock struct {
	header Block
	rows   []Block
}

func Table(header Block, rows ...Block) TableBlock { return TableBlock{header: header, rows: rows} }

func (t TableBlock) all() ColumnBlock { return Column(append([]Block{t.header}, t.rows...)...) }

func (t TableBlock) Height(c *Canvas, width float64) float64 { return t.all().Height(c, width) }

func (t TableBlock) Draw(c *Canvas, x, y, width float64) { t.all().Draw(c, x, y, width) }

func (t TableBlock) parts(*Canvas, float64) ([]Block, Block) {
	if len(t.rows) == 0 {
		return []Block{t.header}, nil
	}
	parts := []Block{Column(t.header, t.rows[0])}
	return append(parts, t.rows[1:]...), t.header
}
