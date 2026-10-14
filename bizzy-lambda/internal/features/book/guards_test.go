package book_test

import (
	"slices"
	"testing"

	"bizzy-lambda/internal/features/book"
	"bizzy-lambda/internal/platform/command"
)

func TestGuards(t *testing.T) {
	command.CheckTable(t, "testdata/guards.md", "Book", book.Guards, book.InvariantIDs())
	// Every invariant a guard can keep is kept by one, bar those the book
	// keeps by construction (Derive writes them).
	byConstruction := []string{
		"lines-cover-what-exists", "one-live-document-of-each-type", "copies-are-current",
		"credit-with-fee", "receipt-is-the-payment", "draft-without-content", "number-before-issue",
		"share-before-issue", "cancelled-while-editing", "unconfirmed", "unrecorded", "unpaid", "open",
		// Every command checks the client is hers, and moving or deleting a
		// session takes it off the follow-ups made from it.
		"follow-ups-are-a-clients",
	}
	for _, id := range book.Guards.Unguarded(book.InvariantIDs()) {
		if !slices.Contains(byConstruction, id) {
			t.Errorf("no guard keeps %s: add it to a guard's Protects, or here if the book keeps it by construction", id)
		}
	}
}
