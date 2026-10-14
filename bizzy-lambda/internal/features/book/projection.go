package book

import (
	"bizzy-lambda/internal/features/calendar"
	"bizzy-lambda/internal/features/clients"
	"bizzy-lambda/internal/features/followups"
	"bizzy-lambda/internal/features/sessions"
)

// Projection is the event that shows a session as it is: its title in the
// calendar syntax (`? ` while tentative, the name, its place when that
// isn't the client's usual, the fee when one was entered, the package bought
// in it) and its time. Read back (see googlesync), it says the session as it
// is, so a sync finds nothing to do. The event's colour is hers.
func (b *Book) Projection(s *sessions.Session) calendar.Snapshot {
	client := b.Clients[s.ClientID]
	title := calendar.Title{
		Tentative: s.Tentative, Name: WrittenName(client, s.Event.Seen),
		Place: PlaceFor(s.Location, client.HomeVisits),
	}
	if s.FeeTyped && !s.OnCredit() {
		fee := s.FeeCents
		title.FeeCents = &fee
	}
	if p, ok := b.Packages[s.BoughtPackageID]; ok {
		title.Package = &calendar.PackageSpec{Sessions: p.Sessions, PriceCents: p.PriceCents}
	}
	return calendar.Snapshot{Title: calendar.FormatTitle(title), Start: s.Start.UTC(), End: s.End.UTC()}
}

// FollowUpProjection is the event that shows a follow-up as it is: `! Name:
// summary`, when it is due, and its notes as the description.
func (b *Book) FollowUpProjection(f *followups.FollowUp) calendar.Snapshot {
	client := b.Clients[f.ClientID]
	notes := f.Notes
	snap := calendar.Snapshot{
		Title:       calendar.FormatFollowUp(calendar.FollowUpTitle{Name: WrittenFollowUpName(client, f.Event.Seen), Summary: f.Summary}),
		Description: &notes,
	}
	if f.AllDay {
		snap.Date = f.Date(b.Location)
	} else {
		snap.Start, snap.End = f.Due.UTC(), f.End().UTC()
	}
	return snap
}

// WrittenFollowUpName is the name to write in a follow-up's title: the one
// already there if it still means the client, else their name.
func WrittenFollowUpName(client clients.Client, seen *calendar.Snapshot) string {
	if seen == nil {
		return client.Name
	}
	title, err := calendar.ParseFollowUp(seen.Title)
	if err != nil {
		return client.Name
	}
	if clients.MatchName(title.Name, clients.AliasesOf([]clients.Client{client})).Kind == clients.MatchExact {
		return title.Name
	}
	return client.Name
}

// FollowUpWritable reports whether a name reads back as itself in a
// follow-up's title: one with a colon would be cut at it.
func FollowUpWritable(name string) bool {
	parsed, err := calendar.ParseFollowUp(calendar.FormatFollowUp(calendar.FollowUpTitle{Name: name}))
	return err == nil && parsed.Name == name
}

// WrittenName is the name to write in a title for the client: the one
// already there if it still means them (she may write "Jane S"), else their
// name.
func WrittenName(client clients.Client, seen *calendar.Snapshot) string {
	if seen == nil {
		return client.Name
	}
	title, err := calendar.ParseTitle(seen.Title)
	if err != nil {
		return client.Name
	}
	if clients.MatchName(title.Name, clients.AliasesOf([]clients.Client{client})).Kind == clients.MatchExact {
		return title.Name
	}
	return client.Name
}

// Writable reports whether a name reads back as itself in a title: one
// ending like an amount ("Kid 2") would read back as a fee.
func Writable(name string) bool {
	parsed, err := calendar.ParseTitle(calendar.FormatTitle(calendar.Title{Name: name}))
	return err == nil && parsed.Name == name
}

// places are where each letter a title marks puts a session.
var places = map[string]sessions.Location{
	calendar.PlaceVisit: sessions.LocationVisit,
	calendar.PlaceHome:  sessions.LocationOwn,
}

// usual is the client's usual place.
func usual(usuallyVisit bool) sessions.Location {
	if usuallyVisit {
		return sessions.LocationVisit
	}
	return sessions.LocationOwn
}

// LocationOf reads where a session is from the place its title marks, or
// the client's usual place when it marks none.
func LocationOf(place string, usuallyVisit bool) sessions.Location {
	if loc, ok := places[place]; ok {
		return loc
	}
	return usual(usuallyVisit)
}

// PlaceFor is the place a title marks for a location: none when it is the
// client's usual place.
func PlaceFor(loc sessions.Location, usuallyVisit bool) string {
	if loc == usual(usuallyVisit) {
		return ""
	}
	for _, place := range calendar.Places {
		if places[place] == loc {
			return place
		}
	}
	return ""
}
