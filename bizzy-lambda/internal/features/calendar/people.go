package calendar

import (
	"cmp"
	"slices"

	"bizzy-lambda/internal/features/clients"
)

// People maps a normalised name to the Google contacts it may refer to. A
// calendar entry for someone who is a contact but not yet a client becomes a
// suggestion rather than being skipped as personal.
type People map[string][]string

// PersonNames are the names she might write in the calendar for a contact.
type PersonNames struct {
	ResourceName string
	// Full names and nicknames always count.
	Full []string
	// Given counts on its own only when no other contact shares it, so
	// "Sarah" doesn't suggest every Sarah she knows.
	Given string
}

func PeopleOf(all []PersonNames) People {
	givenCount := map[string]int{}
	for _, p := range all {
		if given := clients.NormalizeAlias(p.Given); given != "" {
			givenCount[given]++
		}
	}

	people := People{}
	add := func(name, resourceName string) {
		name = clients.NormalizeAlias(name)
		if name != "" && !slices.Contains(people[name], resourceName) {
			people[name] = append(people[name], resourceName)
		}
	}
	for _, p := range all {
		for _, name := range p.Full {
			add(name, p.ResourceName)
		}
		if given := clients.NormalizeAlias(p.Given); givenCount[given] == 1 {
			add(given, p.ResourceName)
		}
	}
	return people
}

// MatchPeople returns up to limit contacts a name may refer to, closest
// first. Exact matches win outright. Otherwise near misses count, but only
// for names longer than five letters: a contact list is big, and "Gym" is
// one letter away from "Jim".
func MatchPeople(name string, people People, limit int) []string {
	normalized := clients.NormalizeAlias(name)
	if normalized == "" || len(people) == 0 {
		return nil
	}
	if exact := people[normalized]; len(exact) > 0 {
		return exact[:min(len(exact), limit)]
	}
	if len([]rune(normalized)) <= 5 {
		return nil
	}

	type candidate struct {
		name     string
		distance int
	}
	var near []candidate
	for known := range people {
		if d := levenshtein(normalized, known); d <= maxTypoDistance(normalized) {
			near = append(near, candidate{known, d})
		}
	}
	// Ties go alphabetically so results don't depend on map order.
	slices.SortFunc(near, func(a, b candidate) int {
		return cmp.Or(cmp.Compare(a.distance, b.distance), cmp.Compare(a.name, b.name))
	})

	var out []string
	for _, c := range near {
		for _, rn := range people[c.name] {
			if len(out) < limit && !slices.Contains(out, rn) {
				out = append(out, rn)
			}
		}
	}
	return out
}
