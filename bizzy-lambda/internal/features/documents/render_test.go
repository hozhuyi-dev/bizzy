package documents

import (
	"bytes"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"
)

var update = flag.Bool("update", false, "rewrite testdata/*.pdf from the renderer")

var sampleIssuer = Issuer{
	Name: "Acme Physio", RegistrationNo: "202401234567 (1234567-X)",
	Address: "12 Jalan Bukit Bintang\n55100 Kuala Lumpur", Phone: "012-345 6789", Email: "hello@acmephysio.my",
	BankName: "Maybank", AccountName: "Acme Physio", AccountNo: "5123 4567 8901",
}

func sample(t Type, number string, lines int) Printed {
	c := Content{
		Date:      "2026-10-22",
		Issuer:    sampleIssuer,
		Recipient: Recipient{Name: "Jane Tan Mei Ling", IDNo: "900101-14-5678", Phone: "not printed", Address: "not printed"},
		Notes:     "Home visit sessions, October.",
	}
	for i := range lines {
		c.Lines = append(c.Lines, Line{
			ID: fmt.Sprint(i), Date: fmt.Sprintf("2026-10-%02d", i%28+1),
			Description: "Physiotherapy session (1 h), home visit with exercise programme review", AmountCents: 18050,
		})
	}
	c.TotalCents = c.Total()
	return Printed{Type: t, Number: number, Content: c, At: time.Date(2026, 10, 22, 9, 30, 0, 0, time.UTC)}
}

// TestRender checks each layout against the PDF kept in testdata: open
// them to see the layout, and rewrite them with -update after changing
// it on purpose.
func TestRender(t *testing.T) {
	for name, p := range map[string]Printed{
		"invoice":      sample(TypeInvoice, "INV260001", 2),
		"receipt":      sample(TypeReceipt, "RCP260042", 1),
		"draft":        func() Printed { p := sample(TypeInvoice, "", 1); p.Draft = true; return p }(),
		"long-invoice": sample(TypeInvoice, "INV260002", 45),
		// Billed to a company, for the family's sessions.
		"family-invoice": func() Printed {
			p := sample(TypeInvoice, "INV260003", 2)
			p.Content.Recipient = Recipient{Name: "Tan Holdings Sdn Bhd", RegNo: "201901012345 (1234567-X)"}
			src := SessionSource("s1")
			p.Content.Lines[1].Source = &src
			p.Content.Lines[1].For = &LineFor{ClientID: "c2", Name: "Adam Tan"}
			return p
		}(),
	} {
		t.Run(name, func(t *testing.T) {
			got, err := Render(p)
			if err != nil {
				t.Fatal(err)
			}
			again, err := Render(p)
			if err != nil || !bytes.Equal(got, again) {
				t.Fatalf("rendering twice made different files (%v)", err)
			}
			path := filepath.Join("testdata", name+".pdf")
			if *update {
				if err := os.WriteFile(path, got, 0o644); err != nil {
					t.Fatal(err)
				}
				return
			}
			want, err := os.ReadFile(path)
			if err != nil {
				t.Fatalf("%v (run with -update to write it)", err)
			}
			if !bytes.Equal(got, want) {
				t.Errorf("%s prints differently: run go test ./internal/features/documents -run TestRender -update and open testdata/%s.pdf", name, name)
			}
		})
	}
}

func TestInWords(t *testing.T) {
	for cents, want := range map[int64]string{
		0:          "Ringgit Malaysia: Zero Only",
		50:         "Ringgit Malaysia: Fifty Sen Only",
		18000:      "Ringgit Malaysia: One Hundred and Eighty Only",
		18050:      "Ringgit Malaysia: One Hundred and Eighty and Fifty Sen Only",
		2100:       "Ringgit Malaysia: Twenty-One Only",
		100500:     "Ringgit Malaysia: One Thousand and Five Only",
		125000:     "Ringgit Malaysia: One Thousand Two Hundred and Fifty Only",
		1100000:    "Ringgit Malaysia: Eleven Thousand Only",
		100000001:  "Ringgit Malaysia: One Million and One Sen Only",
		1234567899: "Ringgit Malaysia: Twelve Million Three Hundred and Forty-Five Thousand Six Hundred and Seventy-Eight and Ninety-Nine Sen Only",
	} {
		if got := InWords(cents); got != want {
			t.Errorf("InWords(%d) = %q, want %q", cents, got, want)
		}
	}
}

func TestPrintedAmount(t *testing.T) {
	for cents, want := range map[int64]string{0: "0.00", 5: "0.05", 18050: "180.50", 125000: "1,250.00", 123456789: "1,234,567.89"} {
		if got := printedAmount(cents); got != want {
			t.Errorf("printedAmount(%d) = %q, want %q", cents, got, want)
		}
	}
}
