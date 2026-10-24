package txn

import (
	"context"
	"maps"
	"slices"
	"strconv"
	"sync"

	"bizzy-lambda/internal/platform/table"
)

// Scope is one request: the kinds its commits changed, which the app is
// told so it reads again only what they show (see router.Response), the
// partitions' versions as the request last saw them, which tell the app
// what others changed, and work left for the request's end, done once
// however many commits asked for it (writing the calendar: see
// googlesync).
type Scope struct {
	mu       sync.Mutex
	changed  map[string]bool
	versions table.Versions
	values   map[any]any
	ends    []func(ctx context.Context)
	counts  map[string]int
}

type scopeKey struct{}

// WithScope starts a request's scope; End finishes it.
func WithScope(ctx context.Context) (context.Context, *Scope) {
	s := &Scope{changed: map[string]bool{}, versions: table.Versions{}, values: map[any]any{}, counts: map[string]int{}}
	return context.WithValue(ctx, scopeKey{}, s), s
}

// Scoped starts a request's scope, and returns the function that ends it
// and says what the request changed, the versions it saw and what it
// counted: router.Router's Scope.
func Scoped(ctx context.Context) (context.Context, func(ctx context.Context) ([]string, map[string]string, map[string]int)) {
	ctx, s := WithScope(ctx)
	return ctx, func(ctx context.Context) ([]string, map[string]string, map[string]int) {
		s.End(ctx)
		return s.Changed(), s.Versions(), s.Counts()
	}
}

// Count adds one to what the request counts under name (reads of the
// table, calls to Google), for its log line; nothing outside a request.
func Count(ctx context.Context, name string) {
	if s := ScopeOf(ctx); s != nil {
		s.mu.Lock()
		defer s.mu.Unlock()
		s.counts[name]++
	}
}

// Counts are what the request counted.
func (s *Scope) Counts() map[string]int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return maps.Clone(s.counts)
}

// ScopeOf is the request's scope; nil outside one (a test calling a
// Runner directly).
func ScopeOf(ctx context.Context) *Scope {
	s, _ := ctx.Value(scopeKey{}).(*Scope)
	return s
}

// Value is what the request keeps under key, made on first use (make may
// use the scope).
func (s *Scope) Value(key any, make func() any) any {
	s.mu.Lock()
	v, ok := s.values[key]
	s.mu.Unlock()
	if ok {
		return v
	}
	v = make()
	s.mu.Lock()
	defer s.mu.Unlock()
	if first, ok := s.values[key]; ok {
		return first // Made meanwhile by another goroutine of the request.
	}
	s.values[key] = v
	return v
}

// Take removes what the request keeps under key, and returns it (nil when
// nothing).
func (s *Scope) Take(key any) any {
	s.mu.Lock()
	defer s.mu.Unlock()
	v := s.values[key]
	delete(s.values, key)
	return v
}

// AtEnd leaves work for the end of the request.
func (s *Scope) AtEnd(fn func(ctx context.Context)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.ends = append(s.ends, fn)
}

// End does the work left for the end, in order, including any that work
// leaves in turn.
func (s *Scope) End(ctx context.Context) {
	for {
		s.mu.Lock()
		if len(s.ends) == 0 {
			s.mu.Unlock()
			return
		}
		fn := s.ends[0]
		s.ends = s.ends[1:]
		s.mu.Unlock()
		fn(ctx)
	}
}

// Changed are the kinds the request's commits changed, sorted.
func (s *Scope) Changed() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return slices.Sorted(maps.Keys(s.changed))
}

// Versions are the partitions' versions as the request last saw them, its
// own commits' included, in decimal: a JavaScript number can't hold one.
// Nil when the request read none.
func (s *Scope) Versions() map[string]string {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.versions) == 0 {
		return nil
	}
	out := make(map[string]string, len(s.versions))
	for pk, v := range s.versions {
		out[pk] = strconv.FormatInt(v, 10)
	}
	return out
}

// saw notes versions read from the table, or moved on to by a commit: the
// latest of each partition counts, since a request's runs may overlap.
func (s *Scope) saw(versions table.Versions) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for pk, v := range versions {
		s.versions[pk] = max(s.versions[pk], v)
	}
}

func (s *Scope) note(changes []Change) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, c := range changes {
		s.changed[c.Kind] = true
	}
}
