// Package money is how bizzy writes amounts and how it records money
// received. What was received for a session or package is what its receipt
// says (see documents), copied onto the item as Paid; it lives apart from
// sessions and packages so both can carry it.
package money

import (
	"fmt"
	"strings"
	"time"

	"bizzy-lambda/internal/platform/apperr"
)

type Method string

const (
	MethodCash         Method = "cash"
	MethodTNG          Method = "tng"
	MethodGrab         Method = "grab"
	MethodBankTransfer Method = "bank_transfer"
)

// MethodLabels are the methods she takes, as a receipt prints them.
var MethodLabels = map[Method]string{
	MethodCash:         "Cash",
	MethodTNG:          "Touch 'n Go eWallet",
	MethodGrab:         "GrabPay",
	MethodBankTransfer: "Bank transfer",
}

// Paid is what one item's receipt says was received for it: always in full,
// as clients don't pay in instalments.
type Paid struct {
	AmountCents int64  `json:"amountCents" dynamodbav:"amountCents"`
	Method      Method `json:"method" dynamodbav:"method"`
	// PaidOn is the day, YYYY-MM-DD in her time zone: income counts in its
	// month.
	PaidOn string `json:"paidOn" dynamodbav:"paidOn"`
}

// Input is a payment as she enters it, for one or more items: each is paid
// what it owes.
type Input struct {
	Method Method `json:"method"`
	// PaidOn defaults to today.
	PaidOn string `json:"paidOn"`
}

// Check validates a payment as entered, filling in today for a missing day.
func (in Input) Check(now time.Time, loc *time.Location) (Input, error) {
	in.PaidOn = strings.TrimSpace(in.PaidOn)
	if in.PaidOn == "" {
		in.PaidOn = now.In(loc).Format(time.DateOnly)
	}
	if _, err := time.Parse(time.DateOnly, in.PaidOn); err != nil {
		return in, apperr.Invalid("the payment date must be YYYY-MM-DD")
	}
	if _, ok := MethodLabels[in.Method]; !ok {
		return in, apperr.Invalid("choose how it was paid")
	}
	return in, nil
}

// Format writes an amount as receipts and messages do: "RM 95", "RM 95.50".
func Format(cents int64) string {
	if cents%100 == 0 {
		return fmt.Sprintf("RM %d", cents/100)
	}
	return fmt.Sprintf("RM %d.%02d", cents/100, cents%100)
}
