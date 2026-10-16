package sessions

import (
	"fmt"
	"time"

	"bizzy-lambda/internal/features/attachments"
	"bizzy-lambda/internal/features/clients"
	"bizzy-lambda/internal/features/documents"
	"bizzy-lambda/internal/features/packages"
	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/platform/txn"
)

// Span is a stretch of time.
type Span struct {
	Start time.Time `json:"start"`
	End   time.Time `json:"end"`
}

// Fields are what the app or the calendar sets on a session; nil leaves a
// field as it is. An edit sets only what the user changed.
type Fields struct {
	ClientID  *string        `json:"clientId,omitempty"`
	Time      *Span          `json:"time,omitempty"`
	Tentative *bool          `json:"tentative,omitempty"`
	Location  *Location      `json:"location,omitempty"`
	Fee       *FeeChoice     `json:"fee,omitempty"`
	Package   *PackageChoice `json:"package,omitempty"`
	// UpdatePayment moves what was received for it, and for the package
	// bought in it, to their new amounts, on receipts not issued yet: the
	// money collected or refunded with the change.
	UpdatePayment bool `json:"updatePayment,omitempty"`
}

// Create books a session, at the client's usual place unless f says.
func Create(tx *txn.Tx, f Fields) (*Session, error) {
	if f.ClientID == nil || f.Time == nil {
		return nil, apperr.Invalid("A session needs a client and a time.")
	}
	client, err := clients.Clients.Get(tx, *f.ClientID)
	if err != nil {
		return nil, err
	}
	s := &Session{ID: tx.NewID(), ClientID: client.ID, Location: usualPlace(client), CreatedAt: tx.Now().UTC()}
	if err := Sessions.Add(tx, s); err != nil {
		return nil, err
	}
	if f.Tentative == nil {
		f.Tentative = new(bool)
	}
	return s, apply(tx, s, f, true)
}

// Update changes what f sets.
func Update(tx *txn.Tx, id string, f Fields) (*Session, error) {
	s, err := Sessions.Get(tx, id)
	if err != nil {
		return nil, err
	}
	return s, apply(tx, s, f, false)
}

// apply makes the changes f asks, in this order, since a later step reads
// what an earlier one set: who, when and where, whether confirmed, the
// package bought in it, then what pays for it. Each step checks its own
// rules; the first that refuses stops it, and nothing is written.
func apply(tx *txn.Tx, s *Session, f Fields, isNew bool) error {
	moved, err := reassign(tx, s, f.ClientID, isNew)
	if err != nil {
		return err
	}
	rescheduled := false
	if f.Time != nil {
		rescheduled = !isNew && (!f.Time.Start.Equal(s.Start) || !f.Time.End.Equal(s.End))
		if err := reschedule(tx, s, *f.Time); err != nil {
			return err
		}
	}
	if f.Location != nil {
		if *f.Location != LocationOwn && *f.Location != LocationVisit {
			return apperr.Invalid("A session is at the user's place or a home visit.")
		}
		s.Location = *f.Location
	}
	if f.Tentative != nil {
		if err := setTentative(tx, s, *f.Tentative); err != nil {
			return err
		}
	}
	bought, err := rebuy(tx, s, f.Package, moved || rescheduled)
	if err != nil {
		return err
	}
	if s.PackageID != "" {
		p, ok, err := packages.Packages.Find(tx, s.PackageID)
		if err != nil {
			return err
		}
		if !ok || p.ClientID != s.ClientID {
			moved = true // Its credit is gone, or another client's: choose again.
		}
	}
	if isNew || f.Fee != nil || moved || bought {
		var fee *int64
		if f.Fee != nil {
			fee = f.Fee.Cents
		} else if cents, typed, err := Fee(tx, s); err != nil {
			return err
		} else if typed {
			fee = &cents // A fee typed for it stays.
		}
		if err := price(tx, s, fee); err != nil {
			return err
		}
	}
	if rescheduled {
		if err := documents.Redate(tx, s.Source(), day(tx, s.Start)); err != nil {
			return err
		}
	}
	if f.UpdatePayment {
		for _, src := range []documents.Source{s.Source(), documents.PackageSource(boughtID(tx, s.ID))} {
			if src.ID == "" {
				continue
			}
			if err := documents.Repay(tx, src); err != nil {
				return err
			}
		}
	}
	return nil
}

// reassign makes it another client's session, its lines and the package
// bought in it going to that client's drafts, together. It reports
// whether the client changed.
func reassign(tx *txn.Tx, s *Session, clientID *string, isNew bool) (bool, error) {
	if clientID == nil || *clientID == s.ClientID {
		return false, nil
	}
	if _, err := clients.Clients.Get(tx, *clientID); err != nil {
		return false, err
	}
	if !isNew {
		into := map[documents.Type]string{}
		for _, src := range []documents.Source{s.Source(), documents.PackageSource(boughtID(tx, s.ID))} {
			if src.ID == "" {
				continue
			}
			if err := documents.MoveToClient(tx, src, *clientID, into); err != nil {
				return false, err
			}
		}
	}
	s.ClientID = *clientID
	return !isNew, nil
}

// reschedule moves it, unless another session is then. That is checked
// once the action is done (tx.Later), so sessions moved together, as in a
// swap, are judged where they all end up.
func reschedule(tx *txn.Tx, s *Session, to Span) error {
	if err := validSpan(to); err != nil {
		return err
	}
	s.Start, s.End = to.Start.UTC(), to.End.UTC()
	tx.Later(func() error {
		if _, kept, err := Sessions.Find(tx, s.ID); err != nil || !kept {
			return err
		}
		other, err := overlapping(tx, *s)
		if err != nil || other == nil {
			return err
		}
		name := clientName(tx, other.ClientID)
		return apperr.Refused(
			fmt.Sprintf("That's when %s has a session (%s).", name, other.Start.In(tx.Location()).Format("Mon 2 Jan, 3:04pm")),
			apperr.Remedy{Action: "sessions.update", Target: other.ID, Label: "Move " + name + "'s session"},
		)
	})
	return nil
}

// setTentative confirms it, or makes it tentative again: not while an
// issued invoice charges it, or a payment is recorded for it.
func setTentative(tx *txn.Tx, s *Session, tentative bool) error {
	switch {
	case tentative && !s.Tentative:
		if inv, _, err := documents.Invoice(tx, s.Source()); err != nil {
			return err
		} else if inv != nil && inv.Issued() {
			return apperr.Refused(fmt.Sprintf("%s is issued for this session, so it stays confirmed. Cancel the invoice first.", inv.Number),
				apperr.Remedy{Action: "documents.cancel", Target: inv.ID, Label: "Cancel " + inv.Number})
		}
		if paid, err := documents.Received(tx, s.Source()); err != nil {
			return err
		} else if paid != nil {
			return apperr.Refused("A payment is recorded for it, so it stays confirmed. Undo the payment first.")
		}
		s.Tentative, s.ConfirmedAt = true, nil
	case !tentative && (s.Tentative || s.ConfirmedAt == nil):
		// Confirmed now, or at its start for one already past.
		at := tx.Now().UTC()
		if !s.Start.IsZero() && s.Start.Before(at) {
			at = s.Start
		}
		s.Tentative, s.ConfirmedAt = false, &at
	}
	return nil
}

// rebuy makes the package bought in it what choice says (nil: as it is),
// following the session's client and day when follow is set. It reports
// whether what pays for the session must be chosen again: one was bought
// that wasn't (its first credit pays for it), or the one whose credit
// did is no longer bought.
func rebuy(tx *txn.Tx, s *Session, choice *PackageChoice, follow bool) (bool, error) {
	had, err := packages.BoughtIn(tx, s.ID)
	if err != nil {
		return false, err
	}
	var spec *packages.Bought
	switch {
	case choice != nil:
		spec = choice.Bought
	case had != nil && follow:
		if spec, err = boughtSpec(tx, had); err != nil {
			return false, err
		}
	default:
		return false, nil
	}
	dropped := spec == nil && had != nil && s.PackageID == had.ID
	if dropped {
		// Its credit paid for the session: something else will.
		s.PackageID = ""
	}
	into, err := draftInvoice(tx, s.Source())
	if err != nil {
		return false, err
	}
	p, err := packages.Rebuy(tx, s.ID, s.ClientID, s.Start, spec, into, CreditsUsed)
	return dropped || had == nil && p != nil, err
}

// Delete cancels a session with what was recorded on it, keeping the
// package bought in it as one on its own, or deleting it too. It returns
// the keys of its files, for the caller to delete once this commits.
func Delete(tx *txn.Tx, id string, keepPackage bool) ([]string, error) {
	s, err := Sessions.Get(tx, id)
	if err != nil {
		return nil, err
	}
	if err := CanDelete(tx, s); err != nil {
		return nil, err
	}
	if err := documents.Remove(tx, s.Source(), Describe(tx, s)); err != nil {
		return nil, err
	}
	if err := Sessions.Delete(tx, id); err != nil {
		return nil, err
	}
	if p, err := packages.BoughtIn(tx, id); err != nil {
		return nil, err
	} else if p != nil && keepPackage {
		if _, err := packages.MakeStandalone(tx, p.ID); err != nil {
			return nil, err
		}
	} else if p != nil {
		if err := packages.Delete(tx, p.ID, CreditsUsed); err != nil {
			return nil, err
		}
	}
	if err := Notes.Delete(tx, id); err != nil {
		return nil, err
	}
	return attachments.RemoveAll(tx, attachments.OwnerSession, id)
}

// CanDelete is the refusal for deleting a session: what was received for
// it is undone first, and an issued invoice charging it cancelled.
func CanDelete(tx *txn.Tx, s *Session) error {
	if paid, err := documents.Received(tx, s.Source()); err != nil {
		return err
	} else if paid != nil {
		return documents.Remove(tx, s.Source(), Describe(tx, s)) // Its refusal.
	}
	if inv, _, err := documents.Invoice(tx, s.Source()); err != nil {
		return err
	} else if inv != nil && inv.Issued() {
		return apperr.Refused(fmt.Sprintf("%s is issued for this session. Cancel it first.", inv.Number),
			apperr.Remedy{Action: "documents.cancel", Target: inv.ID, Label: "Cancel " + inv.Number})
	}
	return nil
}

// CanPay is the refusal for recording a payment for a session: it is
// confirmed, and owes something.
func CanPay(tx *txn.Tx, s *Session) error {
	if s.Tentative {
		return apperr.Refused("Confirm the session before recording its payment.",
			apperr.Remedy{Action: "sessions.update", Target: s.ID, Request: map[string]any{"tentative": false}, Label: "Confirm it"})
	}
	n, err := owed(tx, s)
	if err != nil {
		return err
	}
	if n == 0 {
		return apperr.Refused(fmt.Sprintf("Nothing is owed on %s.", Describe(tx, s)))
	}
	return nil
}

// CanUndoPayment is the refusal for undoing a session's payment: one is
// recorded, on a receipt not issued.
func CanUndoPayment(tx *txn.Tx, s *Session) error {
	paid, err := documents.Received(tx, s.Source())
	switch {
	case err != nil:
		return err
	case paid == nil:
		return apperr.Refused("No payment is recorded for it.")
	case paid.Issued:
		r, err := documents.Documents.Get(tx, paid.ReceiptID)
		if err != nil {
			return err
		}
		return apperr.Refused(fmt.Sprintf("%s records it. Cancel it first.", r.Number),
			apperr.Remedy{Action: "documents.cancel", Target: r.ID, Label: "Cancel " + r.Number})
	}
	return nil
}

// CheckIssue holds an invoice to charging confirmed sessions only, before
// it is issued (documents.Check).
func CheckIssue(tx *txn.Tx, d *documents.Document) error {
	if d.Type != documents.TypeInvoice {
		return nil
	}
	for _, line := range d.Draft.Lines {
		if line.Source == nil || line.Source.Kind != documents.SourceSession {
			continue
		}
		s, ok, err := Sessions.Find(tx, line.Source.ID)
		if err != nil {
			return err
		}
		if ok && s.Tentative {
			return apperr.Refused(fmt.Sprintf("Confirm %s before issuing its invoice.", Describe(tx, s)),
				apperr.Remedy{Action: "sessions.update", Target: s.ID, Request: map[string]any{"tentative": false}, Label: "Confirm it"})
		}
	}
	return nil
}

func validSpan(sp Span) error {
	switch {
	case !sp.End.After(sp.Start):
		return apperr.Invalid("A session ends after it starts.")
	case sp.End.Sub(sp.Start) > MaxLength:
		return apperr.Invalid("A session lasts at most %d hours.", int(MaxLength.Hours()))
	}
	return nil
}

func usualPlace(c *clients.Client) Location {
	if c.HomeVisits {
		return LocationVisit
	}
	return LocationOwn
}

func clientName(tx *txn.Tx, id string) string {
	if c, ok, _ := clients.Clients.Find(tx, id); ok {
		return c.Name
	}
	return "someone"
}
