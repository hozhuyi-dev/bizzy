package snapshot

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"regexp"
	"strings"

	"bizzy-lambda/internal/features/clients"
	"bizzy-lambda/internal/features/documents"
	"bizzy-lambda/internal/features/settings"
	"bizzy-lambda/internal/platform/table"
	"bizzy-lambda/internal/platform/txn"
)

// Scrub is what a copy puts in place of every way to reach a client, so
// nothing tried in a test environment reaches one: the business's own
// phone, and its own email tagged for the address it stands in for
// (Email), which mail to "+" addresses delivers to the business.
type Scrub struct {
	Phone string
	Email string
}

// ScrubOf is the scrub to the business's own phone and email in its
// settings, either of them overridden when given.
func ScrubOf(cfg settings.Settings, phone, email string) (Scrub, error) {
	s := Scrub{Phone: cmpOr(phone, cfg.Phone), Email: cmpOr(email, cfg.Email)}
	if s.Phone == "" || !strings.Contains(s.Email, "@") {
		return s, fmt.Errorf("scrub: the copied settings have no business phone and email to put in place of the clients': set COPY_PHONE and COPY_EMAIL")
	}
	return s, nil
}

func cmpOr(a, b string) string {
	if a != "" {
		return a
	}
	return b
}

// EmailFor is the business's email standing in for one address: the same
// for the same address wherever it is, tagged so it says which.
func (s Scrub) EmailFor(email string) string {
	sum := sha256.Sum256([]byte(strings.ToLower(strings.TrimSpace(email))))
	prefix, domain := s.tag()
	return prefix + hex.EncodeToString(sum[:4]) + "@" + domain
}

// tag is how every address EmailFor makes starts, and its domain.
func (s Scrub) tag() (prefix, domain string) {
	local, domain, _ := strings.Cut(s.Email, "@")
	if strings.Contains(local, "+") {
		return local + "-bizzy-", domain
	}
	return local + "+bizzy-", domain
}

var (
	emailPattern = regexp.MustCompile(`[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}`)
	// phonePattern is a Malaysian number, with its country code or
	// without, or any number written with a country code.
	phonePattern = regexp.MustCompile(`\+?60[ \-]?\d{1,2}[ \-]?\d{3,4}[ \-]?\d{4}|\+\d{1,3}[ \-]?\d{1,4}[ \-]?\d{3,4}[ \-]?\d{3,4}|0\d{1,2}[ \-]?(?:\d{3,4}[ \-]?\d{4}|\d{6})`)
	// icPattern is a MyKad number as bizzy keeps it, which reads like a
	// number with a country code.
	icPattern = regexp.MustCompile(`^\d{6}-\d{2}-\d{4}$`)
)

// Text replaces every phone number and email address in the items'
// stored JSON with the scrub's, but those of the business itself: any in
// its settings, which are left as they are. It finds what a pattern can,
// in fields bizzy knows of and any added since (a number in a note), and
// returns how many it replaced in each partition. Contacts, run on the
// code's types once migrated, then replaces the fields it knows whole.
func (s Scrub) Text(items []table.Item) ([]table.Item, map[string]int) {
	own := map[string]bool{normalPhone(s.Phone): true, strings.ToLower(s.Email): true}
	for _, it := range items {
		if it.PK == settings.Store.Name {
			for _, m := range phones(string(it.Data)) {
				own[normalPhone(m)] = true
			}
			for _, m := range emailPattern.FindAllString(string(it.Data), -1) {
				own[strings.ToLower(m)] = true
			}
		}
	}
	out := make([]table.Item, len(items))
	counts := map[string]int{}
	for i, it := range items {
		out[i] = it
		if it.PK == settings.Store.Name {
			continue
		}
		data := string(it.Data)
		n := 0
		data = emailPattern.ReplaceAllStringFunc(data, func(m string) string {
			if own[strings.ToLower(m)] || s.own(m) {
				return m
			}
			n++
			return s.EmailFor(m)
		})
		data = replacePhones(data, func(m string) string {
			if own[normalPhone(m)] {
				return m
			}
			n++
			return s.Phone
		})
		if n > 0 {
			out[i].Data = []byte(data)
			counts[it.PK] += n
		}
	}
	return out, counts
}

// own reports whether an email is the business's: its own, or one EmailFor
// made.
func (s Scrub) own(email string) bool {
	e := strings.ToLower(email)
	prefix, domain := s.tag()
	return e == strings.ToLower(s.Email) || strings.HasPrefix(e, strings.ToLower(prefix)) && strings.HasSuffix(e, "@"+strings.ToLower(domain))
}

// phones are the phone numbers in text (see replacePhones).
func phones(text string) []string {
	var out []string
	replacePhones(text, func(m string) string { out = append(out, m); return m })
	return out
}

// replacePhones replaces each phone number in text with what f returns.
// A match must stand alone: not part of a longer number, a word, an id or
// a hash, and not a MyKad number.
func replacePhones(text string, f func(string) string) string {
	var b strings.Builder
	last := 0
	for _, loc := range phonePattern.FindAllStringIndex(text, -1) {
		start, end := loc[0], loc[1]
		m := text[start:end]
		if !standsAlone(text, start, end) || icPattern.MatchString(m) {
			continue
		}
		b.WriteString(text[last:start])
		b.WriteString(f(m))
		last = end
	}
	b.WriteString(text[last:])
	return b.String()
}

func standsAlone(text string, start, end int) bool {
	// A line break in stored JSON is written \n: what follows it starts
	// a line.
	escaped := start >= 2 && text[start-2] == '\\' && strings.IndexByte("nrt", text[start-1]) >= 0
	if start > 0 && !escaped {
		if c := text[start-1]; isWord(c) || strings.IndexByte("+-/.", c) >= 0 {
			return false
		}
	}
	if end < len(text) {
		c := text[end]
		if isWord(c) {
			return false
		}
		// "0123456789." ends a sentence; "0123456789.5" or "-2" goes on.
		if strings.IndexByte("-/.", c) >= 0 && end+1 < len(text) && isDigit(text[end+1]) {
			return false
		}
	}
	return true
}

func isDigit(c byte) bool { return c >= '0' && c <= '9' }

func isWord(c byte) bool {
	return isDigit(c) || c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c == '_'
}

// normalPhone is a number's digits, from the national 0: the same number
// however it is written.
func normalPhone(p string) string {
	digits := strings.Map(func(r rune) rune {
		if r >= '0' && r <= '9' {
			return r
		}
		return -1
	}, p)
	rest, coded := strings.CutPrefix(digits, "60")
	if coded && (strings.HasPrefix(strings.TrimSpace(p), "+") || len(digits) >= 11) {
		return "0" + rest
	}
	return digits
}

// Contacts replaces, on the code's types, every client's contact phone
// and email and the ones kept on documents with the scrub's, whatever
// they say: what Text may not have recognised as one. It returns how
// many items it changed.
func (s Scrub) Contacts(ctx context.Context, run *txn.Runner) (int, error) {
	phone := func(p *string) bool {
		if *p == "" || *p == s.Phone {
			return false
		}
		*p = s.Phone
		return true
	}
	email := func(e *string) bool {
		if *e == "" || s.own(*e) {
			return false
		}
		*e = s.EmailFor(*e)
		return true
	}
	recipient := func(r *documents.Recipient) bool {
		a, b := phone(&r.Phone), email(&r.Email)
		return a || b
	}
	n, err := Each(ctx, run, clients.Clients, func(c *clients.Client) bool {
		if c.Contact == nil {
			return false
		}
		a, b := phone(&c.Contact.Phone), email(&c.Contact.Email)
		return a || b
	})
	if err != nil {
		return n, err
	}
	docs, err := Each(ctx, run, documents.Documents, func(d *documents.Document) bool {
		changed := false
		for _, c := range []*documents.Content{d.Content, d.Draft} {
			if c != nil && recipient(&c.Recipient) {
				changed = true
			}
		}
		return changed
	})
	n += docs
	if err != nil {
		return n, err
	}
	revs, err := Each(ctx, run, documents.Revisions, func(r *documents.Revision) bool { return recipient(&r.Content.Recipient) })
	return n + revs, err
}

// Each runs change over every item of a kind, a batch to a commit (see
// txn.RunBatched), and returns how many it changed.
func Each[T any](ctx context.Context, run *txn.Runner, kind txn.Kind[T], change func(*T) bool) (int, error) {
	ids, err := txn.Read(ctx, run, kind.IDs)
	if err != nil {
		return 0, err
	}
	n, err := txn.RunBatched(ctx, run, ids, func(tx *txn.Tx, id string) (bool, error) {
		v, err := kind.Get(tx, id)
		if err != nil {
			return false, err
		}
		return change(v), nil
	})
	if err != nil {
		return n, fmt.Errorf("%s: %w", kind.Name, err)
	}
	return n, nil
}
