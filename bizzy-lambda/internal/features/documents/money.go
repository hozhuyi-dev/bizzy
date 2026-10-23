package documents

import (
	"fmt"
	"strings"
	"time"

	"bizzy-lambda/internal/platform/apperr"
)

// Method is how a client paid.
type Method string

const (
	MethodCash         Method = "cash"
	MethodTNG          Method = "tng"
	MethodGrab         Method = "grab"
	MethodBankTransfer Method = "bank_transfer"
)

// MethodLabels are the methods the business takes, as a receipt prints
// them.
var MethodLabels = map[Method]string{
	MethodCash:         "Cash",
	MethodTNG:          "Touch 'n Go eWallet",
	MethodGrab:         "GrabPay",
	MethodBankTransfer: "Bank transfer",
}

// PaymentInput is a payment as the user enters it, for one or more
// items: each is paid in full, as clients don't pay in instalments.
type PaymentInput struct {
	Method Method `json:"method"`
	// PaidOn defaults to today.
	PaidOn string `json:"paidOn"`
}

// Check is the payment as recorded, or the refusal for one that isn't a
// payment.
func (in PaymentInput) Check(now time.Time, loc *time.Location) (Payment, error) {
	p := Payment{Method: in.Method, PaidOn: strings.TrimSpace(in.PaidOn)}
	if p.PaidOn == "" {
		p.PaidOn = now.In(loc).Format(time.DateOnly)
	}
	if _, err := time.Parse(time.DateOnly, p.PaidOn); err != nil {
		return p, apperr.Invalid("The payment date must be YYYY-MM-DD.")
	}
	if _, ok := MethodLabels[p.Method]; !ok {
		return p, apperr.Invalid("Choose how it was paid.")
	}
	return p, nil
}

// Format writes an amount as receipts and messages do: "RM 95", "RM 95.50".
func Format(cents int64) string {
	if cents%100 == 0 {
		return fmt.Sprintf("RM %d", cents/100)
	}
	return fmt.Sprintf("RM %d.%02d", cents/100, cents%100)
}

// InWords writes an amount as Malaysian documents spell it out: "Ringgit
// Malaysia: One Hundred and Eighty Only", "… and Fifty Sen Only".
func InWords(cents int64) string {
	ringgit, sen := cents/100, cents%100
	var words string
	switch {
	case sen == 0:
		words = spell(ringgit)
	case ringgit == 0:
		words = spell(sen) + " Sen"
	default:
		words = spell(ringgit) + " and " + spell(sen) + " Sen"
	}
	return "Ringgit Malaysia: " + words + " Only"
}

var (
	ones = []string{"Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
		"Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"}
	tens   = []string{"", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"}
	scales = []string{"", " Thousand", " Million", " Billion"}
)

// spell writes a whole number in British English, title case: "One
// Thousand Two Hundred and Five", "Twenty-One".
func spell(n int64) string {
	if n == 0 {
		return ones[0]
	}
	var groups []string
	for scale := 0; n > 0 && scale < len(scales); scale++ {
		if g := n % 1000; g > 0 {
			words := spellHundreds(g) + scales[scale]
			// The last group under a hundred joins the rest with "and":
			// "One Thousand and Five".
			if scale == 0 && g < 100 && n >= 1000 {
				words = "and " + words
			}
			groups = append([]string{words}, groups...)
		}
		n /= 1000
	}
	return strings.Join(groups, " ")
}

// spellHundreds writes 1 to 999.
func spellHundreds(n int64) string {
	var parts []string
	if n >= 100 {
		parts = append(parts, ones[n/100]+" Hundred")
		if n%100 > 0 {
			parts = append(parts, "and")
		}
		n %= 100
	}
	switch {
	case n == 0:
	case n < 20:
		parts = append(parts, ones[n])
	case n%10 == 0:
		parts = append(parts, tens[n/10])
	default:
		parts = append(parts, tens[n/10]+"-"+ones[n%10])
	}
	return strings.Join(parts, " ")
}
