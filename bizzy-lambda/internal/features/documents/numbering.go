package documents

import (
	"fmt"
	"time"

	"bizzy-lambda/internal/platform/txn"
)

// Document numbers are AAAYYXXXX: the type's code (RCP, INV), the last two
// digits of the year it was first issued, and a sequence that restarts
// every year. A revision is shown after a dash, from -00: RCP260042-01.
//
// The year is the issue date's, not the document date's, so each year's
// numbers run in the order they were issued. The number is taken on the
// first issue, so drafts leave no gaps.

// Number formats the seq-th document of a type issued in year.
func Number(spec TypeSpec, year int, seq int64) string {
	return fmt.Sprintf("%s%02d%04d", spec.Code, year%100, seq)
}

// Label is a number with its revision, as printed: "RCP260042-00".
func Label(number string, revision int) string {
	return fmt.Sprintf("%s-%02d", number, revision)
}

// CounterKey is the sequence a document of a type issued at t draws from.
func CounterKey(t Type, at time.Time) string {
	return fmt.Sprintf("%s#%d", t, at.Year())
}

// Counter is the last number of a sequence taken.
type Counter struct {
	Key  string `json:"key"`
	Last int64  `json:"last"`
}

var Counters = txn.Kind[Counter]{
	Name: "DOCNUMBER", Gone: "No number was taken yet.",
	Doc:  txn.Doc{What: "The last number taken in a sequence: <type>#<year>."},
	Meta: func(c *Counter) txn.Meta { return txn.Meta{ID: c.Key} },
}

// nextNumber takes the next number of a type, issued now.
func nextNumber(tx *txn.Tx, t Type) (string, error) {
	local := tx.Now().In(tx.Location())
	key := CounterKey(t, local)
	c, ok, err := Counters.Find(tx, key)
	switch {
	case err != nil:
		return "", err
	case !ok:
		c = &Counter{Key: key}
		if err := Counters.Add(tx, c); err != nil {
			return "", err
		}
	}
	c.Last++
	return Number(Types[t], local.Year(), c.Last), nil
}
