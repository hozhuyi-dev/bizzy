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
