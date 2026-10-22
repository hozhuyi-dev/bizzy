package txn

import (
	"encoding/json"
	"maps"
	"slices"
	"sync"

	"bizzy-lambda/internal/platform/table"
)

// A Runner keeps what its runs read from the table, between runs and
// requests: what a partition held at a version (table.Versions) it holds
// whenever it is at that version, so a run that begins with the partition
// there reads it from memory. One user doing one thing at a time means
// most runs read nothing from the table but the versions item.
//
// What a run read from the table is kept only once it is known to be one
// state: its commit went through (which checks what it read hadn't
// moved), or the versions are still where the run began. A commit's own
// writes are applied to what is kept of their partitions, which move on
// with it; queries read a page at a time are dropped instead.
type cache struct {
	mu    sync.Mutex
	table table.Table
	parts map[string]*part
}

// part is what is known of one partition at one version.
type part struct {
	version int64
	// items are items read by id; nil for one there is none of.
	items map[string]*table.Item
	// queries are queries' results, by queryKey.
	queries map[string]cachedQuery
	// whole, once the partition is read whole, is every item in it, by id;
	// it answers every read of it.
	whole map[string]table.Item
}

type cachedQuery struct {
	q     table.Query
	items []table.Item
}

func newPart(version int64) *part {
	return &part{version: version, items: map[string]*table.Item{}, queries: map[string]cachedQuery{}}
}

func queryKey(q table.Query) string {
	b, _ := json.Marshal(q)
	return string(b)
}

// get is an item, and whether the part knows it.
func (p *part) get(sk string) (it table.Item, ok, known bool) {
	if p.whole != nil {
		it, ok = p.whole[sk]
		return it, ok, true
	}
	found, known := p.items[sk]
	if found != nil {
		return *found, true, true
	}
	return table.Item{}, false, known
}

// query is a query's result, and whether the part knows it.
func (p *part) query(q table.Query) ([]table.Item, bool) {
	if p.whole != nil {
		return table.Select(slices.Collect(maps.Values(p.whole)), q), true
	}
	c, ok := p.queries[queryKey(q)]
	return c.items, ok
}

// maxQueries bounds the queries kept of one partition: pages of searches
// pile up in a warm Lambda while their partition doesn't move.
const maxQueries = 1000

// merge adds what another part of the same version knows.
func (p *part) merge(o *part) {
	maps.Copy(p.items, o.items)
	if len(p.queries)+len(o.queries) > maxQueries {
		clear(p.queries)
	}
	maps.Copy(p.queries, o.queries)
	if o.whole != nil {
		p.whole = o.whole
	}
}

// apply makes the part what a commit's writes to it leave: items and
// whole as written, a query read whole (no Limit or After) with the items
// written moved in or out, and a query read a page at a time kept while
// no write could change its page (see moves), dropped otherwise.
func (p *part) apply(writes []table.Write) {
	written := map[string]bool{}
	var puts []table.Item
	if p.whole != nil {
		p.whole = maps.Clone(p.whole)
	}
	for _, w := range writes {
		switch {
		case w.Put != nil:
			it := *w.Put
			p.items[it.SK] = &it
			written[it.SK] = true
			puts = append(puts, it)
			if p.whole != nil {
				p.whole[it.SK] = it
			}
		case w.Delete != nil:
			p.items[w.Delete.SK] = nil
			written[w.Delete.SK] = true
			if p.whole != nil {
				delete(p.whole, w.Delete.SK)
			}
		}
	}
	for key, c := range p.queries {
		switch {
		case c.q.Limit == 0 && c.q.After == nil:
			kept := slices.DeleteFunc(slices.Clone(c.items), func(it table.Item) bool { return written[it.SK] })
			p.queries[key] = cachedQuery{c.q, table.Select(append(kept, puts...), c.q)}
		case moves(c, written, puts):
			delete(p.queries, key)
		}
	}
}

// moves reports whether writes could change a page's result: one of its
// items was written, or an item written now falls in it (past After and,
// on a full page, before its last item). An item written out of the
// query, or past a full page, leaves it as it was.
func moves(c cachedQuery, written map[string]bool, puts []table.Item) bool {
	if slices.ContainsFunc(c.items, func(it table.Item) bool { return written[it.SK] }) {
		return true
	}
	for _, it := range puts {
		if !c.q.Matches(it) || !c.q.Past(it) {
			continue
		}
		full := c.q.Limit > 0 && len(c.items) == c.q.Limit
		if !full || c.q.Order(table.PlaceOf(c.q.Index, it), table.PlaceOf(c.q.Index, c.items[len(c.items)-1])) < 0 {
			return true
		}
	}
	return false
}

// cacheMu guards giving a Runner its cache.
var cacheMu sync.Mutex

// cache is the Runner's, for its Table: a copy of the Runner on another
// table (a dry run's) gets its own.
func (r *Runner) cache() *cache {
	cacheMu.Lock()
	defer cacheMu.Unlock()
	if r.kept == nil || r.kept.table != r.Table {
		r.kept = &cache{table: r.Table, parts: map[string]*part{}}
	}
	return r.kept
}

// prune forgets every partition that moved from the version it was kept
// at.
func (c *cache) prune(now table.Versions) {
	c.mu.Lock()
	defer c.mu.Unlock()
	for pk, p := range c.parts {
		if now[pk] != p.version {
			delete(c.parts, pk)
		}
	}
}

// with calls f on what is kept of a partition at a version, if anything
// is, and returns what f returns.
func (c *cache) with(pk string, version int64, f func(p *part) bool) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	p := c.parts[pk]
	return p != nil && p.version == version && f(p)
}

// keep adds what a run read from the table at versions, then applies its
// commit's writes, which moved their partitions on to moved; nil for a run
// that committed nothing.
func (c *cache) keep(versions table.Versions, fetched map[string]*part, writes []table.Write, moved table.Versions) {
	c.mu.Lock()
	defer c.mu.Unlock()
	for pk, f := range fetched {
		v := versions[pk]
		p := c.parts[pk]
		if p == nil || p.version != v {
			p = newPart(v)
			c.parts[pk] = p
		}
		p.merge(f)
	}
	byPK := map[string][]table.Write{}
	for _, w := range writes {
		byPK[w.PK()] = append(byPK[w.PK()], w)
	}
	for pk, ws := range byPK {
		p := c.parts[pk]
		if p == nil || p.version != versions[pk] {
			// Nothing kept of it as it was: only what was written is known.
			p = newPart(0)
			c.parts[pk] = p
		}
		p.apply(ws)
		p.version = moved[pk]
	}
}
