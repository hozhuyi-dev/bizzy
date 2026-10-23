package settings

import (
	"bytes"
	"context"
	"flag"
	"image/png"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"bizzy-lambda/internal/testutil/memblob"
)

var update = flag.Bool("update", false, "rewrite testdata/paypage from the renderer")

var paying = Settings{
	BusinessName: "Physio Co", Phone: "012-345 6789",
	BankName: "Maybank", AccountName: "Physio Co Sdn Bhd", AccountNo: "5140 1234 5678",
	DuitNowQR: sampleQR, PayApps: []PayApp{PayDuitNow, PayTnG, PayGrabPay},
}

func TestPayApps(t *testing.T) {
	got, err := payApps([]PayApp{PayGrabPay, PayDuitNow, PayGrabPay})
	if err != nil || !slices.Equal(got, []PayApp{PayDuitNow, PayGrabPay}) {
		t.Fatalf("payApps = %v, %v; want duitnow, grabpay", got, err)
	}
	if _, err := payApps([]PayApp{"boost"}); err == nil {
		t.Fatal("an unknown app was taken")
	}
}

func TestCheckPay(t *testing.T) {
	with := func(change func(*Settings)) Settings {
		s := paying
		change(&s)
		return s
	}
	for name, c := range map[string]struct {
		s    Settings
		want string // in the refusal; "" passes
	}{
		"all of it":                    {paying, ""},
		"nothing":                      {Settings{}, ""},
		"apps on the business phone":   {with(func(s *Settings) { s.PayPhone = "" }), ""},
		"apps on a phone of its own":   {with(func(s *Settings) { s.PayPhone = "+60 11-2345 6789" }), ""},
		"apps and no phone at all":     {with(func(s *Settings) { s.Phone, s.PayPhone = "", "" }), "Add the phone number"},
		"a pay phone that isn't one":   {with(func(s *Settings) { s.PayPhone = "TnG me" }), "isn't a phone number"},
		"a pay phone too short":        {with(func(s *Settings) { s.PayPhone = "0123" }), "isn't a phone number"},
		"apps out of order":            {with(func(s *Settings) { s.PayApps = []PayApp{PayTnG, PayDuitNow} }), "listed once"},
		"a QR that isn't a DuitNow QR": {with(func(s *Settings) { s.DuitNowQR = "hello" }), "isn't a DuitNow QR"},
	} {
		err := checkPay(c.s)
		switch {
		case c.want == "" && err != nil:
			t.Errorf("%s: refused: %v", name, err)
		case c.want != "" && (err == nil || !strings.Contains(err.Error(), c.want)):
			t.Errorf("%s: got %v; want a refusal saying %q", name, err, c.want)
		}
	}
}

func TestPayPageOf(t *testing.T) {
	p := PayPageOf(paying)
	if p.Phone != "012-345 6789" || p.ProofTo != "60123456789" || p.Bank == nil {
		t.Fatalf("PayPageOf = %+v", p)
	}
	if got := p.summary(); got != "Pay by DuitNow QR, bank transfer or DuitNow / TnG / GrabPay to phone." {
		t.Errorf("summary = %q", got)
	}
	// Bank details are all or nothing, and apps are what shows the phone.
	bare := PayPageOf(Settings{BusinessName: "Physio Co", Phone: "012-345 6789", BankName: "Maybank"})
	if bare.Bank != nil || bare.Phone != "" || bare.QR != "" {
		t.Errorf("PayPageOf without the details = %+v", bare)
	}
	if got := bare.summary(); got != "Ask me how to pay." {
		t.Errorf("summary with nothing to pay by = %q", got)
	}
}

func TestPayPageHTML(t *testing.T) {
	s := paying
	s.BusinessName = `Physio <Co> & "Sons"`
	page, err := PayPageOf(s).HTML("https://pay.example")
	if err != nil {
		t.Fatal(err)
	}
	html := string(page)
	for _, want := range []string{
		`<meta property="og:url" content="https://pay.example/">`,
		`<meta property="og:site_name" content="Physio &lt;Co&gt; &amp; &#34;Sons&#34;">`,
		`<meta property="og:image" content="https://pay.example/preview.png?v=`,
		`<meta property="og:image:alt" content="Payment details for Physio &lt;Co&gt; &amp; &#34;Sons&#34;: DuitNow QR, Bank transfer (Maybank), DuitNow / TnG / GrabPay to phone">`,
		`<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg `, // A wallet; not the app's bee.
		`id="save-qr" href="qr.png?v=`,
		`<meta name="robots" content="noindex, nofollow">`,
		`Physio &lt;Co&gt; &amp; &#34;Sons&#34;`,
		`data-copy="514012345678"`, // The account number as a bank app takes it.
		`data-copy="0123456789"`,
		`href="https://wa.me/60123456789?text=`, // Proof of payment, with a greeting typed in.
		`src="qr.png?v=`,
		`<span class="chip">Touch &#39;n Go eWallet</span>`,
	} {
		if !strings.Contains(html, want) {
			t.Errorf("the page has no %s", want)
		}
	}
	if strings.Contains(html, "<Co>") {
		t.Error("the business name isn't escaped")
	}

	plain, err := PayPageOf(Settings{BusinessName: "Physio Co"}).HTML("https://pay.example")
	if err != nil {
		t.Fatal(err)
	}
	for _, absent := range []string{"qr.png", "Bank transfer", "Pay to phone number", "wa.me"} {
		if strings.Contains(string(plain), absent) {
			t.Errorf("a page with nothing set shows %q", absent)
		}
	}
}

// TestPayPageFiles compares the page and its images with testdata/paypage;
// -update rewrites them, to open and look at after a layout change.
func TestPayPageFiles(t *testing.T) {
	for name, s := range map[string]Settings{
		"full":  paying,
		"no-qr": func() Settings { s := paying; s.DuitNowQR = ""; s.PayApps = nil; return s }(),
		"long-name": func() Settings {
			s := paying
			s.BusinessName = "Pusat Fisioterapi Dan Pemulihan Sukan Kuala Lumpur Sdn Bhd"
			return s
		}(),
	} {
		t.Run(name, func(t *testing.T) {
			p := PayPageOf(s)
			files := map[string]func() ([]byte, error){
				"index.html":  func() ([]byte, error) { return p.HTML("https://pay.example") },
				"preview.png": p.PreviewPNG,
			}
			if p.QR != "" {
				files["qr.png"] = p.QRPNG
			}
			for file, render := range files {
				got, err := render()
				if err != nil {
					t.Fatal(err)
				}
				again, err := render()
				if err != nil || !bytes.Equal(got, again) {
					t.Fatalf("%s: rendering twice made different files (%v)", file, err)
				}
				if strings.HasSuffix(file, ".png") {
					img, err := png.Decode(bytes.NewReader(got))
					if err != nil {
						t.Fatalf("%s: %v", file, err)
					}
					if b := img.Bounds(); file == "preview.png" && (b.Dx() != 1200 || b.Dy() != 630) {
						t.Errorf("the preview is %v; WhatsApp shows 1200 by 630 large", b)
					}
					if file == "qr.png" {
						w, h, err := p.QRSize()
						if b := img.Bounds(); err != nil || b.Dx() != w || b.Dy() != h {
							t.Errorf("the QR is %v; the page makes room for %dx%d (%v)", b, w, h, err)
						}
					}
				}
				path := filepath.Join("testdata", "paypage", name, file)
				if *update {
					if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
						t.Fatal(err)
					}
					if err := os.WriteFile(path, got, 0o644); err != nil {
						t.Fatal(err)
					}
					continue
				}
				want, err := os.ReadFile(path)
				if err != nil {
					t.Fatalf("%v (run with -update to write it)", err)
				}
				if !bytes.Equal(got, want) {
					t.Errorf("%s/%s comes out differently: run go test ./internal/features/settings -run TestPayPageFiles -update and open testdata/paypage/%s", name, file, name)
				}
			}
		})
	}
}

func TestPublish(t *testing.T) {
	ctx := context.Background()
	store := memblob.New()
	site := PaySite{Store: store, URL: "https://pay.example"}
	if err := site.Publish(ctx, paying); err != nil {
		t.Fatal(err)
	}
	for _, key := range PayKeys {
		if _, ok := store.Blobs[key]; !ok {
			t.Errorf("%s wasn't published", key)
		}
	}
	if got := store.Blobs[PayPageKey].ContentType; got != "text/html; charset=utf-8" {
		t.Errorf("the page is served as %q", got)
	}
	// Link previews may fetch the page; nothing else may.
	robots := string(store.Blobs[PayRobotsKey].Body)
	for _, want := range []string{"User-agent: facebookexternalhit\n", "User-agent: WhatsApp\n", "Allow: /\n", "\nUser-agent: *\nDisallow: /\n"} {
		if !strings.Contains(robots, want) {
			t.Errorf("robots.txt has no %q:\n%s", want, robots)
		}
	}

	without := paying
	without.DuitNowQR = ""
	if err := site.Publish(ctx, without); err != nil {
		t.Fatal(err)
	}
	if _, ok := store.Blobs[PayQRKey]; ok {
		t.Error("the QR is still published once taken off")
	}

	if err := site.Unpublish(ctx); err != nil {
		t.Fatal(err)
	}
	if len(store.Blobs) != 0 {
		t.Errorf("unpublishing left %d files", len(store.Blobs))
	}
}
