package settings

// The payment page: one static page the payment message links to, with
// every way to pay (the DuitNow QR, bank transfer, and the phone number
// the user's e-wallets take), the same for every client. It is files on a
// site of its own (bizzy-infra's PaySite), written whenever the settings
// are saved, so opening it costs no Lambda call and no read of the table,
// and WhatsApp finds its preview in the page itself.
//
// It shows nothing the payment message doesn't already send every client
// (the bank details, the phone), so its address is fixed and needs no
// token; it asks not to be indexed.

import (
	"bytes"
	"context"
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"html/template"
	"slices"
	"strings"
	"sync"

	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/platform/blobstore"
)

// PayApp is an app clients can pay the pay phone with.
type PayApp string

const (
	PayDuitNow PayApp = "duitnow"
	PayTnG     PayApp = "tng"
	PayGrabPay PayApp = "grabpay"
)

// PayApps are every PayApp, in the order the page lists them.
var PayApps = []PayApp{PayDuitNow, PayTnG, PayGrabPay}

// Label is how the page names it.
func (a PayApp) Label() string {
	switch a {
	case PayDuitNow:
		return "DuitNow"
	case PayTnG:
		return "Touch 'n Go eWallet"
	case PayGrabPay:
		return "GrabPay"
	}
	return string(a)
}

// Short is how a line of a few of them names it.
func (a PayApp) Short() string {
	if a == PayTnG {
		return "TnG"
	}
	return a.Label()
}

// payApps is apps without repeats, in PayApps' order; an app it doesn't
// know is refused.
func payApps(apps []PayApp) ([]PayApp, error) {
	for _, a := range apps {
		if !slices.Contains(PayApps, a) {
			return nil, apperr.Invalid("There's no payment app %q.", a)
		}
	}
	var out []PayApp
	for _, a := range PayApps {
		if slices.Contains(apps, a) {
			out = append(out, a)
		}
	}
	return out, nil
}

// checkPay is whether what the payment page shows can be shown.
func checkPay(s Settings) error {
	if s.DuitNowQR != "" {
		if err := CheckDuitNowQR(s.DuitNowQR); err != nil {
			return err
		}
	}
	if apps, err := payApps(s.PayApps); err != nil {
		return err
	} else if !slices.Equal(apps, s.PayApps) {
		return apperr.Invalid("Each payment app is listed once.")
	}
	if s.PayPhone != "" && !isPhone(s.PayPhone) {
		return apperr.Invalid("%q isn't a phone number clients can pay to.", s.PayPhone)
	}
	if len(s.PayApps) > 0 && payPhone(s) == "" {
		return apperr.Invalid("Add the phone number clients pay to, or your phone number.")
	}
	return nil
}

// payPhone is the number clients pay to: the pay phone, or the business
// phone when that is blank.
func payPhone(s Settings) string {
	if s.PayPhone != "" {
		return s.PayPhone
	}
	return s.Phone
}

func digits(s string) string {
	return strings.Map(func(r rune) rune {
		if r >= '0' && r <= '9' {
			return r
		}
		return -1
	}, s)
}

// isPhone is whether s reads as a phone number: 9 to 15 digits, written
// with spaces, dashes, brackets or a leading +.
func isPhone(s string) bool {
	n := len(digits(s))
	return n >= 9 && n <= 15 && strings.Trim(s, "0123456789 -+()") == ""
}

// whatsappNumber is a Malaysian number as WhatsApp links take it: the
// leading 0 becomes 60, as the app does (whatsapp.util.ts).
func whatsappNumber(phone string) string {
	d := digits(phone)
	if strings.HasPrefix(d, "0") {
		d = "6" + d
	}
	if len(d) < 9 {
		return ""
	}
	return d
}

// PaySite is where the payment page is published: its own bucket, served
// at URL ("https://….cloudfront.net", no trailing slash). No Store, no
// page (tests that don't look at it).
type PaySite struct {
	Store blobstore.Store
	URL   string
}

// The payment page's files, at the root of its site.
const (
	PayPageKey    = "index.html"
	PayQRKey      = "qr.png"
	PayPreviewKey = "preview.png"
	PayRobotsKey  = "robots.txt"
)

// PayKeys are every file the payment page may have.
var PayKeys = []string{PayPageKey, PayQRKey, PayPreviewKey, PayRobotsKey}

// payRobots keeps crawlers off the page, but for the link previews of
// WhatsApp, Facebook, Messenger and Telegram: they heed it too, and would
// show a bare link. The page's tags still ask not to be indexed.
const payRobots = `User-agent: facebookexternalhit
User-agent: Facebot
User-agent: WhatsApp
User-agent: TelegramBot
Allow: /

User-agent: *
Disallow: /
`

// PayPage is what the payment page shows.
type PayPage struct {
	Business string   `json:"business"`
	Bank     *PayBank `json:"bank,omitempty"`
	QR       string   `json:"qr,omitempty"`
	// Phone is the number clients pay to with Apps (none, no phone).
	Phone string   `json:"phone,omitempty"`
	Apps  []PayApp `json:"apps,omitempty"`
	// ProofTo is the business's WhatsApp number, for sending proof of
	// payment; blank when it has none.
	ProofTo string `json:"proofTo,omitempty"`
}

// PayBank is the account to transfer to.
type PayBank struct {
	Name        string `json:"name"`
	AccountName string `json:"accountName"`
	AccountNo   string `json:"accountNo"`
}

// PayPageOf is the payment page the settings make.
func PayPageOf(s Settings) PayPage {
	p := PayPage{Business: s.BusinessName, QR: s.DuitNowQR, ProofTo: whatsappNumber(s.Phone)}
	if s.BankName != "" && s.AccountName != "" && s.AccountNo != "" {
		p.Bank = &PayBank{Name: s.BankName, AccountName: s.AccountName, AccountNo: s.AccountNo}
	}
	if len(s.PayApps) > 0 {
		p.Phone = payPhone(s)
		p.Apps = s.PayApps
	}
	return p
}

// ways are the ways to pay, as a line each: "DuitNow QR", "Bank transfer
// (Maybank)", "DuitNow / TnG / GrabPay to phone".
func (p PayPage) ways() []string {
	var out []string
	if p.QR != "" {
		out = append(out, "DuitNow QR")
	}
	if p.Bank != nil {
		out = append(out, "Bank transfer ("+p.Bank.Name+")")
	}
	if len(p.Apps) > 0 {
		out = append(out, p.phoneWay())
	}
	return out
}

// phoneWay is paying the phone: "DuitNow / TnG / GrabPay to phone".
func (p PayPage) phoneWay() string {
	var names []string
	for _, a := range p.Apps {
		names = append(names, a.Short())
	}
	return strings.Join(names, " / ") + " to phone"
}

// version names what the page shows, so a change makes new image URLs:
// WhatsApp and browsers keep an image by its URL.
func (p PayPage) version() string {
	b, _ := json.Marshal(p)
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:6])
}

// title heads the page and its preview.
func (p PayPage) title() string {
	if p.Business == "" {
		return "Payment details"
	}
	return "Pay " + p.Business
}

// previewAlt says what the preview shows: "Payment details for Physio
// Co: DuitNow QR, Bank transfer (Maybank)".
func (p PayPage) previewAlt() string {
	alt := "Payment details"
	if p.Business != "" {
		alt += " for " + p.Business
	}
	if ways := p.ways(); len(ways) > 0 {
		alt += ": " + strings.Join(ways, ", ")
	}
	return alt
}

// summary is the ways to pay, as the preview's description says them.
func (p PayPage) summary() string {
	var ways []string
	if p.QR != "" {
		ways = append(ways, "DuitNow QR")
	}
	if p.Bank != nil {
		ways = append(ways, "bank transfer")
	}
	if len(p.Apps) > 0 {
		ways = append(ways, p.phoneWay())
	}
	switch len(ways) {
	case 0:
		return "Ask me how to pay."
	case 1:
		return "Pay by " + ways[0] + "."
	}
	return "Pay by " + strings.Join(ways[:len(ways)-1], ", ") + " or " + ways[len(ways)-1] + "."
}

//go:embed paypage.html
var payPageHTML string

var payPageTemplate = template.Must(template.New("paypage").Parse(payPageHTML))

// HTML is the page, with its preview's absolute URL on siteURL.
func (p PayPage) HTML(siteURL string) ([]byte, error) {
	var qrWidth, qrHeight int
	if p.QR != "" {
		var err error
		if qrWidth, qrHeight, err = p.QRSize(); err != nil {
			return nil, err
		}
	}
	var buf bytes.Buffer
	err := payPageTemplate.Execute(&buf, map[string]any{
		"QRWidth":       qrWidth,
		"QRHeight":      qrHeight,
		"Page":          p,
		"Title":         p.title(),
		"Summary":       p.summary(),
		"PreviewAlt":    p.previewAlt(),
		"Version":       p.version(),
		"SiteURL":       siteURL,
		"AccountDigits": digitsOf(p.Bank),
		"PhoneDigits":   digits(p.Phone),
	})
	return buf.Bytes(), err
}

func digitsOf(b *PayBank) string {
	if b == nil {
		return ""
	}
	return digits(b.AccountNo)
}

// Publish writes the payment page the settings make: the images first,
// then the page that shows them.
func (site PaySite) Publish(ctx context.Context, s Settings) error {
	p := PayPageOf(s)
	preview, err := p.PreviewPNG()
	if err != nil {
		return err
	}
	images := []func() error{
		func() error { return site.Store.Put(ctx, PayPreviewKey, "image/png", preview) },
	}
	if p.QR != "" {
		qr, err := p.QRPNG()
		if err != nil {
			return err
		}
		images = append(images, func() error { return site.Store.Put(ctx, PayQRKey, "image/png", qr) })
	} else {
		images = append(images, func() error { return site.Store.Delete(ctx, PayQRKey) })
	}
	if err := parallel(images...); err != nil {
		return err
	}
	page, err := p.HTML(site.URL)
	if err != nil {
		return err
	}
	return parallel(
		func() error { return site.Store.Put(ctx, PayPageKey, "text/html; charset=utf-8", page) },
		func() error { return site.Store.Put(ctx, PayRobotsKey, "text/plain; charset=utf-8", []byte(payRobots)) },
	)
}

// Unpublish removes the payment page.
func (site PaySite) Unpublish(ctx context.Context) error {
	return site.Store.Delete(ctx, PayKeys...)
}

// parallel runs each at once, and returns their errors.
func parallel(fns ...func() error) error {
	errs := make([]error, len(fns))
	var wg sync.WaitGroup
	for i, fn := range fns {
		wg.Go(func() { errs[i] = fn() })
	}
	wg.Wait()
	return errors.Join(errs...)
}
