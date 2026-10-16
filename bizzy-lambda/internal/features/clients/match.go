package clients

// MatchKind is how a name (an event's, usually) relates to the known client aliases.
type MatchKind int

const (
	MatchNone MatchKind = iota
	// MatchNearMiss is a likely typo of an alias. It is surfaced to the user rather
	// than silently skipped, so a misspelt session never goes missing.
	MatchNearMiss
	MatchExact
)

type NameMatch struct {
	Kind     MatchKind
	ClientID string
	// Alias is the alias that was matched, or the closest one on a near miss.
	Alias string
}

// Aliases maps a normalised alias to the client that owns it.
type Aliases map[string]string

// AliasesOf indexes every name of every client for matching.
func AliasesOf(all []*Client) Aliases {
	aliases := make(Aliases)
	for _, client := range all {
		for _, name := range client.Names() {
			aliases[name] = client.ID
		}
	}
	return aliases
}

// MatchName finds the client an event name refers to.
func MatchName(name string, aliases Aliases) NameMatch {
	normalized := Normalize(name)
	if normalized == "" {
		return NameMatch{Kind: MatchNone}
	}

	if clientID, ok := aliases[normalized]; ok {
		return NameMatch{Kind: MatchExact, ClientID: clientID, Alias: normalized}
	}

	best := NameMatch{Kind: MatchNone}
	bestDistance := maxTypoDistance(normalized) + 1
	for alias, clientID := range aliases {
		d := levenshtein(normalized, alias)
		// Ties go to the alphabetically first alias so results don't depend
		// on map iteration order.
		if d < bestDistance || (d == bestDistance && best.Kind == MatchNearMiss && alias < best.Alias) {
			bestDistance = d
			best = NameMatch{Kind: MatchNearMiss, ClientID: clientID, Alias: alias}
		}
	}

	return best
}

// maxTypoDistance keeps short names strict: two edits turn "jo" into "al".
func maxTypoDistance(name string) int {
	if len([]rune(name)) <= 5 {
		return 1
	}
	return 2
}

func levenshtein(a, b string) int {
	ar, br := []rune(a), []rune(b)
	prev := make([]int, len(br)+1)
	curr := make([]int, len(br)+1)
	for j := range prev {
		prev[j] = j
	}

	for i := 1; i <= len(ar); i++ {
		curr[0] = i
		for j := 1; j <= len(br); j++ {
			cost := 1
			if ar[i-1] == br[j-1] {
				cost = 0
			}
			curr[j] = min(prev[j]+1, curr[j-1]+1, prev[j-1]+cost)
		}
		prev, curr = curr, prev
	}

	return prev[len(br)]
}
