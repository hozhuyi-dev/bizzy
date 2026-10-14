package sessions

import (
	"time"

	"bizzy-lambda/internal/platform/apperr"
)

// Guards are the preconditions of the mutations that touch a session, in
// one place: the handlers call them, and the Impossible rules (rules.go)
// name the mutations whose guards keep them from happening. Each returns
// the error shown to the user, or nil.

// CanPay reports whether a payment can be recorded or changed. A package
// credit leaves nothing to pay on the session itself: a payment would make
// it keep a fee of its own instead (see billing.Allocate).
func (s Session) CanPay() error {
	if err := s.CanUndoPayment(); err != nil {
		return err
	}
	if s.Status == StatusPackage {
		return apperr.Conflict("A package credit covers this session, so nothing is due on it.")
	}
	return nil
}

// CanUndoPayment reports whether a payment recorded by mistake can be
// removed: also once the session is gone from the calendar, so that it can
// then be discarded.
func (s Session) CanUndoPayment() error {
	if s.RemovedAt == nil {
		if err := s.CanSettle(); err != nil {
			return err
		}
	}
	if s.Receipt != nil {
		return apperr.Conflict("A receipt covers this payment. Cancel or discard it first.")
	}
	return nil
}

// CanSettle reports whether the session is at the stage where money is
// settled on it at all: in the calendar, confirmed, and read.
func (s Session) CanSettle() error {
	switch {
	case s.RemovedAt != nil:
		return apperr.Conflict("Restore the session before changing its payment.")
	case s.Status == StatusTentative:
		return apperr.Conflict("Confirm the session before recording its payment.")
	case !s.Status.Delivered():
		return apperr.Conflict("Fix the calendar entry before recording its payment.")
	}
	return nil
}

// CanInvoice reports whether an invoice can be made for the session's fee.
func (s Session) CanInvoice() error {
	if s.RemovedAt != nil || s.Status != StatusPriced || s.FeeCents == nil || s.Invoice != nil {
		return apperr.Conflict("only a confirmed session with a fee and no invoice yet can get one")
	}
	return nil
}

// CanReceipt reports whether a receipt can be made for the session's fee:
// once it is paid.
func (s Session) CanReceipt() error {
	if s.RemovedAt != nil || s.Status != StatusPriced || s.FeeCents == nil || s.Receipt != nil || !s.Payment.IsPaid() {
		return apperr.Conflict("only a paid session without a receipt can get one")
	}
	if s.Payment.Outdated(s.DueCents()) {
		return apperr.Conflict("The fee changed since it was paid: record the payment at the new fee first.")
	}
	return nil
}

// CanRecord reports whether its summary and notes can be written: once it
// has started, and while it is in the calendar. A removed session is kept
// only for what is on it, so clearing that would strand it (see the
// removed-without-data rule).
func (s Session) CanRecord(now time.Time) error {
	switch {
	case s.RemovedAt != nil:
		return apperr.Conflict("Restore the session before changing its notes.")
	case s.Start.After(now):
		return apperr.Conflict("Notes can be written once the session has started.")
	}
	return nil
}

// CanAttach reports whether files can be attached or removed: as for the
// notes, once it has started and while it is in the calendar.
func (s Session) CanAttach(now time.Time) error {
	switch {
	case s.RemovedAt != nil:
		return apperr.Conflict("Restore the session before changing its files.")
	case s.Start.After(now):
		return apperr.Conflict("Files can be attached once the session has started.")
	}
	return nil
}

// CanDelete reports whether it can be deleted from the app with what is
// recorded on it: not while paid, as the record of money received would go
// with it, nor while a document covers it.
func (s Session) CanDelete() error {
	switch {
	case s.Payment.IsPaid():
		return apperr.Conflict("Undo the payment first: deleting the session would lose the record of it.")
	case s.HasDocuments():
		return apperr.Conflict("Cancel or discard the invoice and receipt for this session first.")
	}
	return nil
}

// CanRestore reports whether it can be restored or discarded: only once
// gone from the calendar.
func (s Session) CanRestore() error {
	if s.RemovedAt == nil {
		return apperr.Conflict("This session is still in the calendar.")
	}
	return nil
}

// CanDiscard reports whether a removed session can be dropped with what
// was recorded on it: not while a document covers it.
func (s Session) CanDiscard() error {
	if err := s.CanRestore(); err != nil {
		return err
	}
	return s.CanDelete()
}
