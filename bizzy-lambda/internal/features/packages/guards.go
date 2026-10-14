package packages

import (
	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/shared/docref"
)

// Guards are the preconditions of the mutations that touch a package, in
// one place: the handlers call them, and the Impossible rules (rules.go)
// name the mutations whose guards keep them from happening. Each returns
// the error shown to the user, or nil.

// CanPay reports whether its payment can be recorded, changed or undone.
func (p Package) CanPay() error {
	if p.Receipt != nil {
		return apperr.Conflict("A receipt covers this package. Cancel or discard it first.")
	}
	return nil
}

// CanBill reports whether a document of the slot's type can be made for
// it: an invoice any time, a receipt once it is paid.
func (p Package) CanBill(slot docref.Slot) error {
	switch {
	case p.Ref(slot) != nil && slot == docref.SlotInvoice:
		return apperr.Conflict("this package already has an invoice")
	case p.Ref(slot) != nil:
		return apperr.Conflict("this package already has a receipt")
	case slot == docref.SlotReceipt && !p.Payment.IsPaid():
		return apperr.Conflict("only a paid package can get a receipt")
	case slot == docref.SlotReceipt && p.Payment.Outdated(p.PriceCents):
		return apperr.Conflict("The price changed since it was paid: record the payment at the new price first.")
	}
	return nil
}

// CanEdit reports whether it can be changed in the app: one bought in the
// calendar is changed there, and a document freezes it.
func (p Package) CanEdit() error {
	switch {
	case p.Unlinked:
		return apperr.Conflict("Its session is gone from the calendar: make it a standalone package first.")
	case p.Source != SourceApp:
		return apperr.Conflict("this package comes from the calendar; change it there")
	case p.HasDocuments():
		return apperr.Conflict("cancel the documents for this package first")
	}
	return nil
}

// CanDelete reports whether it can be deleted in the app: one added in the
// app, or one the calendar no longer buys; not while paid, as the record
// of money received would go with it, nor while a document covers it.
func (p Package) CanDelete() error {
	switch {
	case p.Source != SourceApp && !p.Unlinked:
		return apperr.Conflict("this package comes from the calendar; remove it there")
	case p.Payment.IsPaid():
		return apperr.Conflict("Undo the payment first: deleting the package would lose the record of it.")
	case p.HasDocuments():
		return apperr.Conflict("cancel the documents for this package first")
	}
	return nil
}

// CanMakeStandalone reports whether it can become one of the app's, kept
// with its credits, payment and documents: once the calendar no longer
// buys it.
func (p Package) CanMakeStandalone() error {
	if !p.Unlinked {
		return apperr.Conflict("Only a package whose session is gone from the calendar can be made standalone.")
	}
	return nil
}
