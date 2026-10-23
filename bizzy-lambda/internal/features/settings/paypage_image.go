package settings

// The payment page's images: the QR, drawn again from what it says (sharp
// at any size, and labelled, so it is easy to find among a client's
// photos), and the preview WhatsApp shows under the link. Both come out
// the same for the same page, byte for byte.

import (
	"bytes"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"strings"
	"sync"

	"golang.org/x/image/font"
	"golang.org/x/image/font/gofont/gobold"
	"golang.org/x/image/font/gofont/goregular"
	"golang.org/x/image/font/opentype"
	"golang.org/x/image/math/fixed"
	"rsc.io/qr"
)

// The page's colours: the app's honey for the bar, and a deep honey
// brown for the label, as the honey is too light to read on white.
var (
	ink    = color.RGBA{0x1c, 0x19, 0x17, 0xff}
	muted  = color.RGBA{0x73, 0x6b, 0x66, 0xff}
	honey  = color.RGBA{0xda, 0x8a, 0x11, 0xff}
	accent = color.RGBA{0x5d, 0x39, 0x17, 0xff}
	paper  = color.RGBA{0xff, 0xff, 0xff, 0xff}
	warm   = color.RGBA{0xfa, 0xf7, 0xf2, 0xff}
)

// quietZone is the blank border, in modules, a scanner needs round a QR.
const quietZone = 4

// qrModules is the QR of payload: whether each module is dark.
func qrModules(payload string) (*qr.Code, error) {
	return qr.Encode(payload, qr.M)
}

// drawQR draws the code at (x, y), each module scale pixels, with its
// quiet zone, on white.
func drawQR(dst draw.Image, code *qr.Code, x, y, scale int) {
	side := (code.Size + 2*quietZone) * scale
	draw.Draw(dst, image.Rect(x, y, x+side, y+side), image.NewUniform(paper), image.Point{}, draw.Src)
	dark := image.NewUniform(ink)
	for my := range code.Size {
		for mx := range code.Size {
			if code.Black(mx, my) {
				px, py := x+(mx+quietZone)*scale, y+(my+quietZone)*scale
				draw.Draw(dst, image.Rect(px, py, px+scale, py+scale), dark, image.Point{}, draw.Src)
			}
		}
	}
}

// qrLabelHeight is the space under the QR that names it.
const qrLabelHeight = 110

// qrScale is the pixels a module of code takes in QRPNG, and how wide
// that makes it: 600 pixels or a little less.
func qrScale(code *qr.Code) (scale, side int) {
	modules := code.Size + 2*quietZone
	scale = max(600/modules, 4)
	return scale, modules * scale
}

// QRSize is QRPNG's size in pixels, for the page to make room for it.
func (p PayPage) QRSize() (width, height int, err error) {
	code, err := qrModules(p.QR)
	if err != nil {
		return 0, 0, err
	}
	_, side := qrScale(code)
	return side, side + qrLabelHeight, nil
}

// QRPNG is the QR on its own, 600 pixels or so wide, with the business
// name and "DuitNow QR" under it.
func (p PayPage) QRPNG() ([]byte, error) {
	code, err := qrModules(p.QR)
	if err != nil {
		return nil, err
	}
	scale, side := qrScale(code)
	img := image.NewRGBA(image.Rect(0, 0, side, side+qrLabelHeight))
	draw.Draw(img, img.Bounds(), image.NewUniform(paper), image.Point{}, draw.Src)
	drawQR(img, code, 0, 0, scale)
	name := faces().bold(30)
	small := faces().regular(22)
	title := p.Business
	if title == "" {
		title = "Payment"
	}
	centred(img, name, fit(name, title, side-40), side/2, side+38, ink)
	centred(img, small, "DuitNow QR", side/2, side+80, muted)
	return encodePNG(img)
}

// PreviewPNG is the card WhatsApp shows under the link, 1200 by 630 (the
// shape it shows large): the business and the ways to pay, and the QR.
func (p PayPage) PreviewPNG() ([]byte, error) {
	const w, h, pad = 1200, 630, 72
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	draw.Draw(img, img.Bounds(), image.NewUniform(warm), image.Point{}, draw.Src)
	draw.Draw(img, image.Rect(0, 0, w, 14), image.NewUniform(honey), image.Point{}, draw.Src)

	textRight := w - pad
	if p.QR != "" {
		code, err := qrModules(p.QR)
		if err != nil {
			return nil, err
		}
		modules := code.Size + 2*quietZone
		scale := 440 / modules
		side := modules * scale
		x, y := w-pad-side, 14+(h-14-side)/2
		drawQR(img, code, x, y, scale)
		textRight = x - 48
	}
	width := textRight - pad

	label, name, line := faces().bold(26), faces().bold(64), faces().regular(34)
	y := 150
	write(img, label, "PAYMENT DETAILS", pad, y, accent)
	y += 82
	title := p.Business
	if title == "" {
		title = "How to pay"
	}
	for _, l := range wrap(name, title, width, 2) {
		write(img, name, l, pad, y, ink)
		y += 76
	}
	y += 22
	for _, way := range p.ways() {
		write(img, line, fit(line, way, width), pad, y, muted)
		y += 52
	}
	return encodePNG(img)
}

func encodePNG(img image.Image) ([]byte, error) {
	var buf bytes.Buffer
	err := (&png.Encoder{CompressionLevel: png.BestCompression}).Encode(&buf, img)
	return buf.Bytes(), err
}

// fontSet is the Go fonts, parsed once. A face isn't safe to share
// between goroutines, so each drawing makes its own.
type fontSet struct{ regularFont, boldFont *opentype.Font }

var faces = sync.OnceValue(func() fontSet {
	return fontSet{regularFont: mustParse(goregular.TTF), boldFont: mustParse(gobold.TTF)}
})

func mustParse(ttf []byte) *opentype.Font {
	f, err := opentype.Parse(ttf)
	if err != nil {
		panic(err)
	}
	return f
}

func (f fontSet) regular(size float64) font.Face { return newFace(f.regularFont, size) }
func (f fontSet) bold(size float64) font.Face    { return newFace(f.boldFont, size) }

func newFace(src *opentype.Font, size float64) font.Face {
	face, err := opentype.NewFace(src, &opentype.FaceOptions{Size: size, DPI: 72, Hinting: font.HintingFull})
	if err != nil {
		panic(err)
	}
	return face
}

// write draws s with its baseline at (x, y).
func write(dst draw.Image, face font.Face, s string, x, y int, c color.Color) {
	d := font.Drawer{Dst: dst, Src: image.NewUniform(c), Face: face, Dot: fixed.P(x, y)}
	d.DrawString(s)
}

// centred draws s centred on x, its baseline at y.
func centred(dst draw.Image, face font.Face, s string, x, y int, c color.Color) {
	write(dst, face, s, x-font.MeasureString(face, s).Round()/2, y, c)
}

func widthOf(face font.Face, s string) int { return font.MeasureString(face, s).Round() }

// fit is s, cut short with an ellipsis if it is wider than width.
func fit(face font.Face, s string, width int) string {
	if widthOf(face, s) <= width {
		return s
	}
	r := []rune(s)
	for len(r) > 0 && widthOf(face, string(r)+"…") > width {
		r = r[:len(r)-1]
	}
	return strings.TrimSpace(string(r)) + "…"
}

// wrap is s in at most lines lines no wider than width, the last cut
// short if it all doesn't fit.
func wrap(face font.Face, s string, width, lines int) []string {
	var out []string
	words := strings.Fields(s)
	for len(words) > 0 && len(out) < lines {
		n := 1
		for n < len(words) && widthOf(face, strings.Join(words[:n+1], " ")) <= width {
			n++
		}
		if len(out) == lines-1 {
			n = len(words)
		}
		out = append(out, fit(face, strings.Join(words[:n], " "), width))
		words = words[n:]
	}
	return out
}
