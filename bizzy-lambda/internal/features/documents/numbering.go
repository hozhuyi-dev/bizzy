package documents

import (
	"fmt"
	"time"

	"bizzy-lambda/internal/schema"
)

// Document numbers are AAAYYXXXX: the type's code (RCP, INV), the last two
// digits of the year it was first issued, and a sequence that restarts every
// year. A revision is shown after a dash, from -00: RCP260042-01.
//
// The year is the issue date's, not the document date's: a receipt dated in
// December but issued in January takes January's year, so each year's
// numbers run in the order they were issued.

// Number formats the seq-th document of a type issued in year.
func Number(spec TypeSpec, year int, seq int64) string {
	return fmt.Sprintf("%s%02d%04d", spec.Code, year%100, seq)
}

// Label is a number with its revision, as printed: "RCP260042-00".
func Label(number string, revision int) string {
	return fmt.Sprintf("%s-%02d", number, revision)
}

// counterKey is the sequence a document of a type issued at t draws from.
func counterKey(docType Type, t time.Time) string {
	return schema.CounterKeys(string(docType), t.Year()).SK
}
