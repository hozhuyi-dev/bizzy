// Package migrations is every change to how bizzy's items are stored,
// oldest first: the table's SQL migrations. A deploy runs those the table
// hasn't had (cmd/migrate, see platform/migrate), and the code serves only
// a table at Version.
//
// Every change to a stored type (a field added, renamed, removed or
// retyped) or to where a kind files its items (its Meta) needs one; one
// with no Up is enough when no item needs changing by hand. TestSchema
// fails until there is one. To add one:
//
//  1. Write NNN_<what>.go declaring a migrate.Migration. It works on the
//     items' JSON (migrate.EachItem for most), never on a feature's types,
//     which go on changing after it.
//  2. Append it to All. Never reorder, change or remove one that has been
//     deployed: the table counts them.
//  3. Unless its Up is nil, add testdata/NNN/before.json (items as the
//     version before stored them) and after.json (what it must leave);
//     see migrations_test.go.
//  4. Update SCHEMA.md: go test ./internal/app -run TestSchema -update.
//  5. Check it against real data: pnpm lambda:migrate:dry.
package migrations

import "bizzy-lambda/internal/platform/migrate"

// All are the migrations; the Nth takes the table from version N-1 to N.
// Version 0 is the shape before any.
var All = []migrate.Migration{
	paymentPerLine,
}

// Version is the schema this code reads and writes: how many migrations
// there are.
var Version = len(All)
