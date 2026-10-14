package documents

import (
	"fmt"
	"slices"
	"strings"
	"time"

	"bizzy-lambda/internal/features/clients"
	"bizzy-lambda/internal/features/settings"
	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/shared/money"
)

// Fill completes a draft as it would be issued now: the business from
// Settings and the client from their contact, where she hasn't written her
// own. Issued content is never filled again.
func Fill(c Content, cfg settings.Settings, client clients.Client) Content {
	if c.Issuer == (Issuer{}) {
		c.Issuer = issuerFrom(cfg)
	}
	if c.Recipient == (Recipient{}) {
		c.Recipient = recipientFrom(client)
	}
	if c.Payment != nil {
		c.PaidBy = money.MethodLabels[c.Payment.Method]
	}
	return c
}

func issuerFrom(cfg settings.Settings) Issuer {
	return Issuer{
		Name:           cfg.BusinessName,
		RegistrationNo: cfg.RegistrationNo,
		Address:        cfg.Address,
		Email:          cfg.Email,
		Phone:          cfg.Phone,
		BankName:       cfg.BankName,
		AccountName:    cfg.AccountName,
		AccountNo:      cfg.AccountNo,
	}
}

// recipientFrom takes the client's details from their copy of the Google
// contact.
func recipientFrom(c clients.Client) Recipient {
	r := Recipient{Name: c.Name}
	if contact := c.Contact; contact != nil {
		r.Email, r.Phone, r.Address = contact.Email, contact.Phone, contact.Address
		if contact.Postcode != "" && !strings.Contains(r.Address, contact.Postcode) {
			r.Address = strings.TrimSpace(r.Address + " " + contact.Postcode)
		}
	}
	return r
}

// Total adds up the lines.
func (c Content) Total() int64 {
	var total int64
	for _, l := range c.Lines {
		total += l.AmountCents
	}
	return total
}

// Normalize trims what she typed, checks it and computes the total. A
// draft may have no date yet (it takes the day it is issued). Lines keep
// their ids and sources: editing the text never changes what a line covers.
func Normalize(in Content) (Content, error) {
	out := Content{
		Date:      strings.TrimSpace(in.Date),
		Issuer:    trimIssuer(in.Issuer),
		Recipient: trimRecipient(in.Recipient),
		Payment:   in.Payment,
		PaidBy:    strings.TrimSpace(in.PaidBy),
		Notes:     strings.TrimSpace(in.Notes),
	}
	if out.Date != "" {
		if _, err := time.Parse(time.DateOnly, out.Date); err != nil {
			return out, apperr.Invalid("date must be YYYY-MM-DD")
		}
	}
	if len(in.Lines) == 0 {
		return out, apperr.Invalid("add at least one line")
	}
	for i, line := range in.Lines {
		line.Description = strings.TrimSpace(line.Description)
		line.Date = strings.TrimSpace(line.Date)
		switch {
		case line.Description == "":
			return out, apperr.Invalid("line %d needs a description", i+1)
		case line.AmountCents < 0:
			return out, apperr.Invalid("line %d can't be negative", i+1)
		}
		if line.Date != "" {
			if _, err := time.Parse(time.DateOnly, line.Date); err != nil {
				return out, apperr.Invalid("line %d date must be YYYY-MM-DD", i+1)
			}
		}
		out.Lines = append(out.Lines, line)
	}
	out.TotalCents = out.Total()
	return out, nil
}

// Legal says what a revision of an issued document changes that only a
// new document may: whom it is for is the client's, so only their name as
// printed may be corrected; what it charges or confirms (each line's item
// and amount, the total), its date, the business that issued it and, on a
// receipt, how and when it was paid stay as issued. Descriptions, service
// dates, notes and contact and bank details may be corrected. "" when the
// revision changes nothing legal.
//
// Changing any of these goes through a new document instead: cancelling
// this one, or (once built) a credit or debit note.
func Legal(issued, revision Content) string {
	switch {
	case revision.Date != issued.Date:
		return "its date"
	case revision.Issuer.Name != issued.Issuer.Name || revision.Issuer.RegistrationNo != issued.Issuer.RegistrationNo:
		return "the business that issued it"
	case revision.TotalCents != issued.TotalCents:
		return "its total"
	case !samePayment(issued.Payment, revision.Payment):
		return "how and when it was paid"
	case len(revision.Lines) != len(issued.Lines):
		return "its lines"
	}
	for _, line := range revision.Lines {
		i := slices.IndexFunc(issued.Lines, func(l Line) bool { return l.ID == line.ID })
		switch {
		case i < 0:
			return "its lines"
		case !sameSource(issued.Lines[i].Source, line.Source):
			return fmt.Sprintf("what line %q covers", line.Description)
		case issued.Lines[i].AmountCents != line.AmountCents:
			return fmt.Sprintf("the amount of %q", line.Description)
		}
	}
	return ""
}

func samePayment(a, b *Payment) bool {
	return (a == nil && b == nil) || (a != nil && b != nil && *a == *b)
}

func sameSource(a, b *Source) bool {
	return (a == nil && b == nil) || (a != nil && b != nil && *a == *b)
}

// SourceLines indexes the lines that cover an item by what they cover.
func SourceLines(lines []Line) map[Source]Line {
	out := map[Source]Line{}
	for _, line := range lines {
		if line.Source != nil {
			out[*line.Source] = line
		}
	}
	return out
}

func trimIssuer(i Issuer) Issuer {
	return Issuer{
		Name:           strings.TrimSpace(i.Name),
		RegistrationNo: strings.TrimSpace(i.RegistrationNo),
		Address:        strings.TrimSpace(i.Address),
		Email:          strings.TrimSpace(i.Email),
		Phone:          strings.TrimSpace(i.Phone),
		BankName:       strings.TrimSpace(i.BankName),
		AccountName:    strings.TrimSpace(i.AccountName),
		AccountNo:      strings.TrimSpace(i.AccountNo),
	}
}

func trimRecipient(r Recipient) Recipient {
	return Recipient{
		Name:    strings.TrimSpace(r.Name),
		Email:   strings.TrimSpace(r.Email),
		Phone:   strings.TrimSpace(r.Phone),
		Address: strings.TrimSpace(r.Address),
	}
}
