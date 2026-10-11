package documents

import (
	"fmt"
	"strings"
	"time"

	"bizzy-lambda/internal/features/clients"
	"bizzy-lambda/internal/features/packages"
	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/features/settings"
	"bizzy-lambda/internal/platform/apperr"
)

// NewContent prefills a document for a client with the given lines.
func NewContent(cfg settings.Settings, c clients.Client, today string, lines []Line) Content {
	return Content{
		Date:      today,
		Issuer:    issuerFrom(cfg),
		Recipient: recipientFrom(c),
		Lines:     lines,
	}
}

// SessionLine is a paid session on a receipt.
func SessionLine(s sessions.Session, cfg settings.Settings, loc *time.Location) Line {
	return Line{
		Description: cfg.ServiceName,
		Date:        s.Start.In(loc).Format(time.DateOnly),
		AmountCents: *s.FeeCents,
		Source:      &Source{Kind: SourceSession, ID: s.EventID},
	}
}

// PackageLine is a package purchase on a receipt.
func PackageLine(p packages.Package, cfg settings.Settings, loc *time.Location) Line {
	return Line{
		Description: fmt.Sprintf("%s package (%d sessions)", cfg.ServiceName, p.Sessions),
		Date:        p.PurchasedAt.In(loc).Format(time.DateOnly),
		AmountCents: p.PriceCents,
		Source:      &Source{Kind: SourcePackage, ID: p.ID},
	}
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

func recipientFrom(c clients.Client) Recipient {
	address := c.Address
	if c.Postcode != "" && !strings.Contains(address, c.Postcode) {
		address = strings.TrimSpace(address + " " + c.Postcode)
	}
	return Recipient{Name: c.Name, Email: c.Email, Phone: c.Phone, Address: address}
}

// Normalize trims what she typed, checks it and computes the total. Lines
// keep their sources: editing the text never changes what a line covers.
func Normalize(in Content, allowed map[Source]bool) (Content, error) {
	out := Content{
		Date:       strings.TrimSpace(in.Date),
		Issuer:     trimIssuer(in.Issuer),
		Recipient:  trimRecipient(in.Recipient),
		PaidBy:     strings.TrimSpace(in.PaidBy),
		Notes:      strings.TrimSpace(in.Notes),
		TotalCents: 0,
	}

	if _, err := time.Parse(time.DateOnly, out.Date); err != nil {
		return out, apperr.Invalid("date must be YYYY-MM-DD")
	}
	if out.Recipient.Name == "" {
		return out, apperr.Invalid("who it's for is required")
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
		if line.Source != nil && !allowed[*line.Source] {
			return out, apperr.Invalid("line %d refers to something this document does not cover", i+1)
		}
		out.Lines = append(out.Lines, line)
		out.TotalCents += line.AmountCents
	}

	return out, nil
}

// sourceAmounts sums the lines per source: what the document says each
// session or package was paid.
func sourceAmounts(c Content) map[Source]int64 {
	amounts := map[Source]int64{}
	for _, line := range c.Lines {
		if line.Source != nil {
			amounts[*line.Source] += line.AmountCents
		}
	}
	return amounts
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
