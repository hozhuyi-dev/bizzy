package calendar

import (
	"fmt"
	"regexp"
	"slices"
	"strconv"
	"strings"
)

// Title is a session event title parsed against the agreed syntax:
//
//	[?] <name> [(PLACE)] [amount] [NxPRICE | N@TOTAL]
//
// The trailing tokens may come in any order. A title with an amount and a
// package means the client paid `amount` for this session and bought a
// package for later.
type Title struct {
	Tentative bool
	Name      string
	// Place is where the session is, as one of Places' letters; "" leaves
	// it to the client's usual place.
	Place    string
	FeeCents *int64
	Package  *PackageSpec
}

// The places a title can mark, by letter: `(V)` a home visit at the
// client's, `(H)` her own place. A new place (a centre she works from)
// is a new letter.
const (
	PlaceVisit = "V"
	PlaceHome  = "H"
)

// Places are the letters a title may mark a place with, in the order a
// refusal lists them.
var Places = []string{PlaceVisit, PlaceHome}

// PackageSpec is a package bought in a session: `10x85` is 10 hours at 85
// an hour, `10@1000` is 10 hours for 1000 in total (for when the price per
// hour isn't a round number). Either way the total is what's kept.
type PackageSpec struct {
	Hours      int
	PriceCents int64
}

// ParseError explains why a title could not be read. Its
// message is shown to her as-is, so it is written for her, not for us.
type ParseError struct {
	Reason string
}

func (e *ParseError) Error() string { return e.Reason }

var (
	// A leading `RM` is tolerated even though the syntax does not need it.
	amountPattern  = regexp.MustCompile(`^(?i:RM)?(\d+(?:\.\d{1,2})?)$`)
	packagePattern = regexp.MustCompile(`^(\d+)([xX@])(?i:RM)?(\d+(?:\.\d{1,2})?)$`)
	placePattern   = regexp.MustCompile(`^\(([A-Za-z])\)$`)
)

// ParseTitle reads an event title. Any name without trailing tokens parses;
// whether it belongs to a client is the matcher's concern.
func ParseTitle(raw string) (Title, error) {
	var title Title

	rest := strings.TrimSpace(raw)
	if after, ok := strings.CutPrefix(rest, "?"); ok {
		title.Tentative = true
		rest = after
	}

	tokens := strings.Fields(rest)

	// Consume trailing amount/package tokens from the end until a name token.
	for len(tokens) > 0 {
		last := tokens[len(tokens)-1]

		if match := placePattern.FindStringSubmatch(last); match != nil {
			if title.Place != "" {
				return title, &ParseError{Reason: "more than one place, like (V) or (H), in the title"}
			}
			place := strings.ToUpper(match[1])
			if !slices.Contains(Places, place) {
				return title, &ParseError{Reason: fmt.Sprintf("%s marks no place: %s", last, placeHelp())}
			}
			title.Place = place
		} else if match := packagePattern.FindStringSubmatch(last); match != nil {
			if title.Package != nil {
				return title, &ParseError{Reason: "more than one package (10x85 or 10@850) in the title"}
			}
			hours, err := strconv.Atoi(match[1])
			if err != nil || hours < 1 || hours > 1000 {
				return title, &ParseError{Reason: fmt.Sprintf("package %q needs 1 to 1000 hours", last)}
			}
			price := toCents(match[3])
			if match[2] != "@" {
				price *= int64(hours)
			}
			title.Package = &PackageSpec{Hours: hours, PriceCents: price}
		} else if match := amountPattern.FindStringSubmatch(last); match != nil {
			if title.FeeCents != nil {
				return title, &ParseError{Reason: "more than one amount in the title"}
			}
			cents := toCents(match[1])
			title.FeeCents = &cents
		} else {
			break
		}

		tokens = tokens[:len(tokens)-1]
	}

	title.Name = strings.Join(tokens, " ")
	if title.Name == "" {
		return title, &ParseError{Reason: "missing client name"}
	}

	return title, nil
}

// toCents converts a validated decimal string ("95", "95.5", "95.50") to
// cents without going through float64.
func toCents(decimal string) int64 {
	whole, frac, _ := strings.Cut(decimal, ".")
	frac = (frac + "00")[:2]
	// Both halves are digit-only by construction of the patterns above.
	w, _ := strconv.ParseInt(whole, 10, 64)
	f, _ := strconv.ParseInt(frac, 10, 64)
	return w*100 + f
}

// FormatTitle writes a title in the syntax, for sessions she adds or edits
// in the app. A package is written per hour (`10x85`) when the total
// divides evenly, else as a total (`3@250`).
func FormatTitle(t Title) string {
	parts := []string{t.Name}
	if t.Tentative {
		parts[0] = "? " + t.Name
	}
	if t.Place != "" {
		parts = append(parts, "("+t.Place+")")
	}
	if t.FeeCents != nil {
		parts = append(parts, formatCents(*t.FeeCents))
	}
	if p := t.Package; p != nil {
		if p.PriceCents%int64(p.Hours) == 0 {
			parts = append(parts, fmt.Sprintf("%dx%s", p.Hours, formatCents(p.PriceCents/int64(p.Hours))))
		} else {
			parts = append(parts, fmt.Sprintf("%d@%s", p.Hours, formatCents(p.PriceCents)))
		}
	}
	return strings.Join(parts, " ")
}

// placeHelp lists the places a title can mark.
func placeHelp() string {
	return "(V) is a home visit and (H) your place"
}

// formatCents is the inverse of toCents: 9500 → "95", 9550 → "95.50".
func formatCents(cents int64) string {
	if cents%100 == 0 {
		return strconv.FormatInt(cents/100, 10)
	}
	return fmt.Sprintf("%d.%02d", cents/100, cents%100)
}

// FollowUpTitle is a follow-up event title:
//
//	! <name>: <summary>
//
// A reminder to get back to a client, kept in the same calendar as her
// sessions; the `!` is what keeps the sync from reading it as one. The
// summary is optional, and the event's description holds any longer notes.
type FollowUpTitle struct {
	Name    string
	Summary string
}

// IsFollowUp reports whether an event title is a follow-up rather than a
// session.
func IsFollowUp(raw string) bool {
	return strings.HasPrefix(strings.TrimSpace(raw), "!")
}

// ParseFollowUp reads a follow-up title. The name runs to the first colon.
func ParseFollowUp(raw string) (FollowUpTitle, error) {
	rest, ok := strings.CutPrefix(strings.TrimSpace(raw), "!")
	if !ok {
		return FollowUpTitle{}, &ParseError{Reason: "a follow-up starts with !"}
	}
	name, summary, _ := strings.Cut(rest, ":")
	title := FollowUpTitle{Name: strings.Join(strings.Fields(name), " "), Summary: strings.TrimSpace(summary)}
	if title.Name == "" {
		return title, &ParseError{Reason: "missing client name after the !"}
	}
	return title, nil
}

// FormatFollowUp writes a follow-up title, for ones she makes in the app.
func FormatFollowUp(t FollowUpTitle) string {
	if t.Summary == "" {
		return "! " + t.Name
	}
	return "! " + t.Name + ": " + t.Summary
}
