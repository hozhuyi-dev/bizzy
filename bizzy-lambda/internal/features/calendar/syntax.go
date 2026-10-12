package calendar

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// Title is a session event title parsed against the agreed syntax:
//
//	[?] <name> [amount] [NxPRICE | N@TOTAL]
//
// The two trailing tokens may come in either order. A title with both means
// the client paid `amount` for this session and bought a package for later.
type Title struct {
	Tentative bool
	Name      string
	FeeCents  *int64
	Package   *PackageSpec
}

// PackageSpec is a package bought in a session: `10x85` is 10 sessions at 85
// each, `10@1000` is 10 sessions for 1000 in total (for when the price per
// session isn't a round number). Either way the total is what's kept.
type PackageSpec struct {
	Sessions   int
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

		if match := packagePattern.FindStringSubmatch(last); match != nil {
			if title.Package != nil {
				return title, &ParseError{Reason: "more than one package (10x85 or 10@850) in the title"}
			}
			sessions, err := strconv.Atoi(match[1])
			if err != nil || sessions < 1 || sessions > 1000 {
				return title, &ParseError{Reason: fmt.Sprintf("package %q needs at least 1 session", last)}
			}
			price := toCents(match[3])
			if match[2] != "@" {
				price *= int64(sessions)
			}
			title.Package = &PackageSpec{Sessions: sessions, PriceCents: price}
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
