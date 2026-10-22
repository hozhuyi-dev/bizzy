package googlesync

import (
	"fmt"
	"time"

	"bizzy-lambda/internal/calendar"
	"bizzy-lambda/internal/features/clients"
	"bizzy-lambda/internal/features/documents"
	"bizzy-lambda/internal/features/followups"
	"bizzy-lambda/internal/features/packages"
	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/platform/txn"
)

// ItemKind is what an event shows.
type ItemKind string

const (
	KindSession  ItemKind = "session"
	KindFollowUp ItemKind = "followUp"
)

// Link is which event shows which item, and what the event said when
// bizzy and the calendar last agreed (Seen). An event that differs from
// Seen was edited by the user; an item whose own event (EventOf) differs
// from it changed in bizzy, and is written to the event.
//
// A link outlives its item: a link whose item is gone, or that names
// none (an event bizzy refused, which the user chose to take away), is an
// event still to delete, so a request that dies before deleting it leaves
// the work for the next sync.
type Link struct {
	EventID string            `json:"eventId"`
	Kind    ItemKind          `json:"kind,omitempty"`
	ItemID  string            `json:"itemId,omitempty"`
	Seen    calendar.Snapshot `json:"seen"`
	// Marked says the event carries the item's id (calendar.PropSession),
	// so a sync that forgot the link, on a calendar chosen again, finds it
	// (see linkFor). An event the user made isn't, until bizzy writes it.
	Marked bool `json:"marked,omitempty"`
}

var Links = txn.Kind[Link]{
	Name: "EVENTLINK", Gone: "That event shows nothing of bizzy's.",
	Doc: txn.Doc{What: "Which calendar event shows which session or follow-up, and what it said when they last agreed.", Time: "when the event is", Ref: "the item it shows: <kind>:<id>"},
	Meta: func(l *Link) txn.Meta {
		m := txn.Meta{ID: l.EventID, Time: seenAt(l.Seen)}
		if l.ItemID != "" {
			m.Ref = itemRef(l.Kind, l.ItemID)
		}
		return m
	},
}

func itemRef(kind ItemKind, id string) string { return string(kind) + ":" + id }

// seenAt is when an event is: its start, or its day.
func seenAt(s calendar.Snapshot) time.Time {
	if s.Date != "" {
		day, _ := time.Parse(time.DateOnly, s.Date)
		return day
	}
	return s.Start
}

// LinkOf is an item's link; nil before its event is written.
func LinkOf(tx *txn.Tx, kind ItemKind, id string) (*Link, error) {
	ls, err := Links.WithRef(tx, itemRef(kind, id))
	if err != nil || len(ls) == 0 {
		return nil, err
	}
	return ls[0], nil
}

// SessionOf is the session an event shows; nil when none.
func SessionOf(tx *txn.Tx, eventID string) (*sessions.Session, error) {
	l, ok, err := Links.Find(tx, eventID)
	if err != nil || !ok || l.Kind != KindSession || l.ItemID == "" {
		return nil, err
	}
	s, _, err := sessions.Sessions.Find(tx, l.ItemID)
	return s, err
}

// exists reports whether a link's item is still there to show: a
// cancelled session shows in no event, as a deleted one.
func exists(tx *txn.Tx, kind ItemKind, id string) (bool, error) {
	if id == "" {
		return false, nil
	}
	if kind == KindFollowUp {
		_, ok, err := followups.FollowUps.Find(tx, id)
		return ok, err
	}
	s, ok, err := sessions.Sessions.Find(tx, id)
	return ok && !s.Cancelled(), err
}

// EventOf is the event an item shows: what bizzy writes to it. seen is
// what its event said last, whose name for the client is kept while it
// still means them (the user may write "Jane S").
func EventOf(tx *txn.Tx, kind ItemKind, id string, seen *calendar.Snapshot) (calendar.Snapshot, error) {
	if kind == KindFollowUp {
		fu, err := followups.FollowUps.Get(tx, id)
		if err != nil {
			return calendar.Snapshot{}, err
		}
		return followUpEvent(tx, fu, seen)
	}
	s, err := sessions.Sessions.Get(tx, id)
	if err != nil {
		return calendar.Snapshot{}, err
	}
	return sessionEvent(tx, s, seen)
}

// sessionEvent is a session as its event's title says it: `? ` while
// tentative, the name, the place when it isn't the client's usual, a fee
// typed for it, the package bought in it.
func sessionEvent(tx *txn.Tx, s *sessions.Session, seen *calendar.Snapshot) (calendar.Snapshot, error) {
	client, err := clients.Clients.Get(tx, s.ClientID)
	if err != nil {
		return calendar.Snapshot{}, err
	}
	title := calendar.Title{Tentative: s.Tentative, Name: writtenName(client, seen, false), Place: placeFor(s.Location, client.HomeVisits)}
	if cents, typed, err := sessions.Fee(tx, s); err != nil {
		return calendar.Snapshot{}, err
	} else if typed && len(s.Credits) == 0 {
		title.FeeCents = &cents
	}
	if p, err := packages.BoughtIn(tx, s.ID); err != nil {
		return calendar.Snapshot{}, err
	} else if p != nil {
		price, _, err := documents.Charged(tx, documents.PackageSource(p.ID))
		if err != nil {
			return calendar.Snapshot{}, err
		}
		title.Package = &calendar.PackageSpec{Hours: p.Hours, PriceCents: price}
	}
	return calendar.Snapshot{Title: calendar.FormatTitle(title), Start: s.Start.UTC(), End: s.End.UTC()}, nil
}

// followUpEvent is a follow-up as its event says it: `! Name: summary`,
// when it is due, and its notes as the description.
func followUpEvent(tx *txn.Tx, fu *followups.FollowUp, seen *calendar.Snapshot) (calendar.Snapshot, error) {
	client, err := clients.Clients.Get(tx, fu.ClientID)
	if err != nil {
		return calendar.Snapshot{}, err
	}
	notes := fu.Notes
	snap := calendar.Snapshot{
		Title:       calendar.FormatFollowUp(calendar.FollowUpTitle{Name: writtenName(client, seen, true), Summary: fu.Summary}),
		Description: &notes,
	}
	if fu.AllDay {
		snap.Date = fu.Date(tx.Location())
	} else {
		snap.Start, snap.End = fu.Due.UTC(), fu.End().UTC()
	}
	return snap, nil
}

// writtenName is the name to write in a title: the one already there if
// it still means the client, else their name.
func writtenName(c *clients.Client, seen *calendar.Snapshot, followUp bool) string {
	if seen == nil {
		return c.Name
	}
	var name string
	if followUp {
		t, err := calendar.ParseFollowUp(seen.Title)
		if err != nil {
			return c.Name
		}
		name = t.Name
	} else {
		t, err := calendar.ParseTitle(seen.Title)
		if err != nil {
			return c.Name
		}
		name = t.Name
	}
	for _, n := range c.Names() {
		if n == clients.Normalize(name) {
			return name
		}
	}
	return c.Name
}

// shows is what an event says, as an item of the kind keeps it.
func shows(kind ItemKind, e calendar.Event) calendar.Snapshot {
	if kind == KindFollowUp {
		return calendar.NotedSnapshotOf(e)
	}
	return calendar.SnapshotOf(e)
}

// IsSession reports whether a new event is a session: a timed event that
// isn't a follow-up.
func IsSession(e calendar.Event) bool { return !e.AllDay && !calendar.IsFollowUp(e.Title) }

// IsFollowUp reports whether an event is a follow-up (`!`).
func IsFollowUp(e calendar.Event) bool { return calendar.IsFollowUp(e.Title) }

// The places a title marks: (V) a home visit, (H) the user's own place.
// No mark means the client's usual place.
func locationOf(place string, homeVisits bool) sessions.Location {
	switch place {
	case calendar.PlaceVisit:
		return sessions.LocationVisit
	case calendar.PlaceHome:
		return sessions.LocationOwn
	}
	if homeVisits {
		return sessions.LocationVisit
	}
	return sessions.LocationOwn
}

func placeFor(loc sessions.Location, homeVisits bool) string {
	switch {
	case loc == locationOf("", homeVisits):
		return ""
	case loc == sessions.LocationVisit:
		return calendar.PlaceVisit
	}
	return calendar.PlaceHome
}

// Invariants are what holds for every link, always.
var Invariants = []txn.Invariant{
	{
		ID: "one-event-per-item", Why: "An item shows in one event, so an edit to it means one thing",
		On: Links.Name,
		Broken: func(tx *txn.Tx, eventID string) ([]string, error) {
			l, ok, err := Links.Find(tx, eventID)
			if err != nil || !ok || l.ItemID == "" {
				return nil, err
			}
			if all, err := Links.WithRef(tx, itemRef(l.Kind, l.ItemID)); err != nil || len(all) > 1 {
				return []string{fmt.Sprintf("%s %s shows in %d events", l.Kind, l.ItemID, len(all))}, err
			}
			return nil, nil
		},
	},
}
