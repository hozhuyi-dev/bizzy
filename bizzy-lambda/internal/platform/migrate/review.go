package migrate

import (
	"context"
	"fmt"
	"strings"

	"bizzy-lambda/internal/platform/table"
	"bizzy-lambda/internal/platform/txn"
)

// reviewed is what review found.
type reviewed struct {
	reviewed int
	// stale are the items the code would write differently, as it would
	// write them: everything a migration wrote, and every item of a kind
	// whose type or Meta changed.
	stale []table.Item
}

// maxShown bounds the problems an error lists.
const maxShown = 20

// review reads every stored item of every kind as the code reads it
// (txn.Kind.Rewrite). One that doesn't read is an error: a field its type
// lacks (renamed or removed with no migration), or a value of another
// type.
func review(ctx context.Context, o Options) (reviewed, error) {
	var r reviewed
	var unreadable []string
	for _, k := range o.Kinds {
		items, err := o.Runner.Table.Query(ctx, table.Query{PK: k.KindName()})
		if err != nil {
			return r, err
		}
		for _, it := range items {
			r.reviewed++
			rewritten, err := k.Rewrite(it)
			switch {
			case err != nil:
				unreadable = append(unreadable, err.Error())
			case string(rewritten.Data) != string(it.Data) || rewritten.Indexes != it.Indexes:
				r.stale = append(r.stale, rewritten)
			}
		}
	}
	if len(unreadable) > 0 {
		return r, problems("items don't read as the code reads them", unreadable)
	}
	return r, nil
}

// checkInvariants checks every invariant on every stored item.
func checkInvariants(ctx context.Context, o Options) error {
	migrator := *o.Runner
	migrator.Migrator, migrator.After = true, nil
	broken, err := txn.CheckAll(ctx, &migrator, o.Kinds...)
	if err != nil {
		return err
	}
	if len(broken) > 0 {
		return problems("invariants are broken", broken)
	}
	return nil
}

func problems(what string, all []string) error {
	shown := all[:min(len(all), maxShown)]
	more := ""
	if len(all) > len(shown) {
		more = fmt.Sprintf("\n…and %d more", len(all)-len(shown))
	}
	return fmt.Errorf("migrate: %d %s:\n%s%s", len(all), what, strings.Join(shown, "\n"), more)
}
