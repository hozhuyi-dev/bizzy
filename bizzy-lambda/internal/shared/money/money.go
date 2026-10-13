// Package money is how a session's fee or a package is settled: paid (by
// some method, on some day) or waived. It lives apart from sessions and
// packages so both can carry a Payment, and the payments feature can write
// either.
package money

import (
	"fmt"
	"strings"
	"time"

	"bizzy-lambda/internal/platform/apperr"
)

type Status string

const (
	Paid Status = "paid"
	// Waived settles something she won't charge for.
	Waived Status = "waived"
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

// Payment settles one item in full: clients don't pay in instalments.
type Payment struct {
	Status Status `json:"status" dynamodbav:"status"`
	// Method is set when paid.
	Method      Method `json:"method,omitempty" dynamodbav:"method,omitempty"`
	AmountCents int64  `json:"amountCents" dynamodbav:"amountCents"`
	// DueCents is what was due when it was recorded, so a later change in
	// the calendar's fee shows as one to fix rather than as settled.
	DueCents int64 `json:"dueCents,omitempty" dynamodbav:"dueCents,omitempty"`
	// PaidOn is the day, YYYY-MM-DD in her time zone: income counts in its
	// month.
	PaidOn    string    `json:"paidOn" dynamodbav:"paidOn"`
	UpdatedAt time.Time `json:"updatedAt" dynamodbav:"updatedAt"`
}

// Outdated reports whether what is due now (dueCents) is no longer what this
// payment settled: the fee changed since, and the amount paid doesn't match
// it either. A waiver settles whatever is due.
func (p *Payment) Outdated(dueCents int64) bool {
	return p.IsPaid() && p.DueCents != dueCents && p.AmountCents != dueCents
}

// IsPaid reports whether money was received, as opposed to waived.
func (p *Payment) IsPaid() bool {
	return p != nil && p.Status == Paid
}

// Input is a payment as she enters it, for one or more items: the amount is
// each item's own.
type Input struct {
	Status Status `json:"status"`
	Method Method `json:"method"`
	// PaidOn defaults to today.
	PaidOn string `json:"paidOn"`
}

// New validates a payment of amount for one item, of which due was due.
func New(in Input, amountCents, dueCents int64, now time.Time, loc *time.Location) (*Payment, error) {
	p := &Payment{Status: in.Status, DueCents: dueCents, PaidOn: strings.TrimSpace(in.PaidOn), UpdatedAt: now.UTC()}
	if p.PaidOn == "" {
		p.PaidOn = now.In(loc).Format(time.DateOnly)
	}
	if _, err := time.Parse(time.DateOnly, p.PaidOn); err != nil {
		return nil, apperr.Invalid("the payment date must be YYYY-MM-DD")
	}

	switch in.Status {
	case Paid:
		if _, ok := MethodLabels[in.Method]; !ok {
			return nil, apperr.Invalid("choose how it was paid")
		}
		if amountCents <= 0 {
			return nil, apperr.Invalid("enter the amount paid")
		}
		p.Method, p.AmountCents = in.Method, amountCents
	case Waived:
	default:
		return nil, apperr.Invalid("a payment is paid or waived")
	}
	return p, nil
}

// PaidBy is how a receipt says what it covers was paid: each method once.
func PaidBy(payments []*Payment) string {
	seen := map[string]bool{}
	var labels []string
	for _, p := range payments {
		if !p.IsPaid() {
			continue
		}
		label := MethodLabels[p.Method]
		if !seen[label] {
			seen[label] = true
			labels = append(labels, label)
		}
	}
	return strings.Join(labels, ", ")
}

// Format writes an amount as receipts and messages do: "RM 95", "RM 95.50".
func Format(cents int64) string {
	if cents%100 == 0 {
		return fmt.Sprintf("RM %d", cents/100)
	}
	return fmt.Sprintf("RM %d.%02d", cents/100, cents%100)
}
