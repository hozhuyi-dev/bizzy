package listing

import (
	"strings"
	"unicode"

	"golang.org/x/text/unicode/norm"
)

// Words are words to find in an item's fields, folded (see fold): "José,"
// is found by "jose" and "JOSE".
type Words []string

// WordsOf splits text into words, without the punctuation hugging them.
func WordsOf(text string) Words {
	var out Words
	for _, w := range strings.Fields(fold(text, nil)) {
		if w = strings.TrimFunc(w, notWordChar); w != "" {
			out = append(out, w)
		}
	}
	return out
}

// In reports whether every word is in one of the fields, anywhere in it;
// no words are in anything.
func (w Words) In(fields ...string) bool {
	if len(w) == 0 {
		return true
	}
	folded := make([]string, len(fields))
	for i, f := range fields {
		folded[i] = fold(f, nil)
	}
	for _, word := range w {
		found := false
		for _, f := range folded {
			if strings.Contains(f, word) {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	return true
}

// excerptRunes is about how long an excerpt is, and leadRunes how much of
// it comes before the word found.
const (
	excerptRunes = 140
	leadRunes    = 40
)

// Excerpt is the part of text around the first place one of the words is
// in it, on one line, with … where it was cut: why a long text was found.
// "" when none of the words is in it.
func (w Words) Excerpt(text string) string {
	var offsets []int
	folded := fold(text, &offsets)
	at := -1
	for _, word := range w {
		if i := strings.Index(folded, word); i >= 0 && (at < 0 || i < at) {
			at = i
		}
	}
	if at < 0 {
		return ""
	}
	runes := []rune(text)
	hit := len([]rune(text[:offsets[at]]))
	start := max(hit-leadRunes, 0)
	end := min(start+excerptRunes, len(runes))
	// Cut between words where there is one near.
	if start > 0 {
		if i := strings.IndexFunc(string(runes[start:hit]), unicode.IsSpace); i >= 0 {
			start += len([]rune(string(runes[start:hit])[:i])) + 1
		}
	}
	if end < len(runes) {
		if i := strings.LastIndexFunc(string(runes[hit:end]), unicode.IsSpace); i > 0 {
			end = hit + len([]rune(string(runes[hit:end])[:i]))
		}
	}
	out := strings.Join(strings.Fields(string(runes[start:end])), " ")
	if start > 0 {
		out = "…" + out
	}
	if end < len(runes) {
		out += "…"
	}
	return out
}

// fold lowers text and takes the accents off it. With offsets, it also
// records, for each byte of what it returns, the byte in text it came
// from, to find a match's place in the original.
func fold(text string, offsets *[]int) string {
	var b strings.Builder
	b.Grow(len(text))
	for i, r := range text {
		before := b.Len()
		if r < unicode.MaxASCII {
			b.WriteRune(unicode.ToLower(r))
		} else {
			for _, d := range norm.NFKD.String(string(r)) {
				if !unicode.Is(unicode.Mn, d) {
					b.WriteRune(unicode.ToLower(d))
				}
			}
		}
		if offsets != nil {
			for range b.Len() - before {
				*offsets = append(*offsets, i)
			}
		}
	}
	return b.String()
}

func notWordChar(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsNumber(r) }
