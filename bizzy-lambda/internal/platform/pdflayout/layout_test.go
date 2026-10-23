package pdflayout

import (
	"bytes"
	"fmt"
	"regexp"
	"testing"
	"time"
)

var at = time.Date(2026, 10, 22, 9, 30, 0, 0, time.UTC)

// pages counts a PDF's pages.
func pages(t *testing.T, pdf []byte) int {
	t.Helper()
	return len(regexp.MustCompile(`/Type /Page\b[^s]`).FindAll(pdf, -1))
}

func rows(n int) []Block {
	out := make([]Block, n)
	for i := range out {
		out[i] = Pad(Text(fmt.Sprintf("Row %d", i)), Sides(10, 0))
	}
	return out
}

func TestRenderNeedsATime(t *testing.T) {
	if _, err := (Document{Body: Text("x")}).Render(); err == nil {
		t.Error("rendered without Info.At, so not the same bytes every time")
	}
}

func TestEmptyBlocksTakeNoRoom(t *testing.T) {
	c := newCanvas(newPDF(Info{At: at}))
	for name, b := range map[string]Block{
		"text":            Text("  "),
		"padded":          Pad(Text(""), All(10)),
		"column of empty": Column(Text(""), Text("")).Gap(10),
	} {
		if h := b.Height(c, 100); h != 0 {
			t.Errorf("%s: height %v, want 0", name, h)
		}
	}
	if h := Column(Text("a"), Text(""), Text("b")).Gap(10).Height(c, 100); h != 2*13.5+10 {
		t.Errorf("a column skips an empty block's gap: height %v", h)
	}
}

func TestTableBreaksBetweenRows(t *testing.T) {
	// 100 rows of about 33pt are about 3,300pt: five A4 pages.
	pdf, err := Document{
		Info: Info{At: at}, Margins: All(40),
		Body: Flow(Text("Title"), Table(Text("Header"), rows(100)...)).Gap(20),
	}.Render()
	if err != nil {
		t.Fatal(err)
	}
	if n := pages(t, pdf); n != 5 {
		t.Errorf("%d pages, want 5", n)
	}
}

func TestBlockTallerThanAPageStillDraws(t *testing.T) {
	pdf, err := Document{Info: Info{At: at}, Body: Flow(Text("Before"), Column(rows(100)...))}.Render()
	if err != nil {
		t.Fatal(err)
	}
	if n := pages(t, pdf); n != 2 {
		t.Errorf("%d pages, want 2: the column moves to its own page and runs off it", n)
	}
}

func TestStampKeepsEveryPage(t *testing.T) {
	doc := Document{Info: Info{At: at}, Margins: All(40), Body: Table(Text("Header"), rows(60)...)}
	original, err := doc.Render()
	if err != nil {
		t.Fatal(err)
	}
	stamped, err := Stamp(original, doc.Info, Watermark{Text: "CANCELLED", Color: Color{R: 213}})
	if err != nil {
		t.Fatal(err)
	}
	if got, want := pages(t, stamped), pages(t, original); got != want || want < 2 {
		t.Errorf("stamped %d pages of %d", got, want)
	}
	if bytes.Equal(stamped, original) {
		t.Error("stamping changed nothing")
	}
	if _, err := Stamp([]byte("not a pdf"), doc.Info, Watermark{Text: "X"}); err == nil {
		t.Error("stamped a file that isn't a PDF")
	}
}
