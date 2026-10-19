package googlesync

import (
	"fmt"
	"time"

	"bizzy-lambda/internal/calendar"
	"bizzy-lambda/internal/features/clients"
	"bizzy-lambda/internal/features/followups"
	"bizzy-lambda/internal/features/packages"
	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/platform/txn"
)

// FromCalendar reads an event, as the user left it, as the actions the app
// would take. Every event in the calendar is bizzy's: a timed one is a
// session, one titled `! Name: summary` a follow-up, and anything else is
// refused, to wait as a conflict until it is fixed or taken away.
//
// A new event makes its item (sessions.Create, followups.Create); an
// edited one changes it with the Fields the user changed (Update); a
// deleted one deletes it. So the calendar can do what the app can, under
// the same rules, and nothing else. Only the title syntax is checked
// here; every business rule is the actions'.
func FromCalendar(tx *txn.Tx, e calendar.Event) error {
	l, err := linkFor(tx, e)
	if err != nil {
		return err
	}
	if l != nil {
		if ok, err := exists(tx, l.Kind, l.ItemID); err != nil || !ok {
			return err // Its item is gone, or it is to go: it is about to be deleted.
		}
	}
	switch {
	case l == nil && e.Cancelled:
		return nil
	case l == nil && IsFollowUp(e):
		return newFollowUp(tx, e)
	case l == nil && e.AllDay:
		return apperr.Refused(`An all-day event is a follow-up: start its title with !, like "! Jane: call back".`)
	case l == nil:
		return newSession(tx, e)
	case l.Kind == KindFollowUp:
		return followUpChanged(tx, l, e)
	}
	return sessionChanged(tx, l, e)
}

// linkFor is the event's link. An event bizzy wrote for an item that has
// no link yet (the request died before recording it, or it is in a
// calendar chosen again) is linked to it now, as showing what it shows:
// bizzy's version, if it differs, is then written over it, so an old
// calendar's event never takes an item back to what it was.
func linkFor(tx *txn.Tx, e calendar.Event) (*Link, error) {
	l, ok, err := Links.Find(tx, e.ID)
	if err != nil || ok {
		return l, err
	}
	kind, id := KindSession, e.Private[calendar.PropSession]
	if fid := e.Private[calendar.PropFollowUp]; fid != "" {
		kind, id = KindFollowUp, fid
	}
	if id == "" {
		return nil, nil
	}
	if ok, err := exists(tx, kind, id); err != nil || !ok {
		return nil, err
	}
	if other, err := LinkOf(tx, kind, id); err != nil || other != nil {
		return nil, err // A copy of its event: a new one.
	}
	l = &Link{EventID: e.ID, Kind: kind, ItemID: id, Seen: shows(kind, e), Marked: true}
	return l, Links.Add(tx, l)
}

func newSession(tx *txn.Tx, e calendar.Event) error {
	f, err := sessionFields(tx, e, nil, "")
	if err != nil {
		return err
	}
	s, err := sessions.Create(tx, f)
	if err != nil {
		return err
	}
	return Links.Add(tx, &Link{EventID: e.ID, Kind: KindSession, ItemID: s.ID, Seen: shows(KindSession, e)})
}

func sessionChanged(tx *txn.Tx, l *Link, e calendar.Event) error {
	s, err := sessions.Sessions.Get(tx, l.ItemID)
	if err != nil {
		return err
	}
	if e.Cancelled {
		if has, err := sessions.HasRecord(tx, s); err != nil {
			return err
		} else if has {
			return apperr.Refused(fmt.Sprintf("%s was deleted in the calendar, but it has notes or files.", capitalize(sessions.Describe(tx, s))),
				apperr.Remedy{Action: "calendar.revert", Target: e.ID, Label: "Put the event back"},
				apperr.Remedy{Action: "sessions.delete", Target: s.ID, Label: "Delete it with its notes"})
		}
		if _, err := sessions.Delete(tx, s.ID, false); err != nil {
			return err
		}
		return Links.Delete(tx, e.ID)
	}
	now := shows(KindSession, e)
	if now.Same(l.Seen) {
		return nil // Nothing bizzy reads changed: its own write, or the colour.
	}
	if !IsSession(e) {
		return apperr.Refused("This event shows a session, so it stays a timed event without a !.")
	}
	f, err := sessionFields(tx, e, &l.Seen, s.ClientID)
	if err != nil {
		return err
	}
	if _, err := sessions.Update(tx, s.ID, f); err != nil {
		return err
	}
	l.Seen = now
	return nil
}

// sessionFields are the fields an event sets: all of them for a new
// session (seen nil), else only what differs from what it said before.
func sessionFields(tx *txn.Tx, e calendar.Event, seen *calendar.Snapshot, clientID string) (sessions.Fields, error) {
	title, err := calendar.ParseTitle(e.Title)
	if err != nil {
		return sessions.Fields{}, apperr.Refused(fmt.Sprintf("The title %q can't be read: %v.", e.Title, err))
	}
	var before calendar.Title
	if seen != nil {
		before, _ = calendar.ParseTitle(seen.Title)
	}
	changed := func(same bool) bool { return seen == nil || !same }
	var f sessions.Fields
	renamed := changed(clients.Normalize(title.Name) == clients.Normalize(before.Name))
	if renamed {
		c, err := clients.Match(tx, title.Name)
		if err != nil {
			return sessions.Fields{}, err
		}
		f.ClientID, clientID = &c.ID, c.ID
	}
	if changed(title.Tentative == before.Tentative) {
		f.Tentative = &title.Tentative
	}
	if changed(seen != nil && e.Start.Equal(seen.Start) && e.End.Equal(seen.End)) {
		f.Time = &sessions.Span{Start: e.Start, End: e.End}
	}
	if changed(sameFee(title.FeeCents, before.FeeCents)) {
		f.Fee = &sessions.FeeChoice{Cents: title.FeeCents}
	}
	if changed(samePackage(title.Package, before.Package)) && (seen != nil || title.Package != nil) {
		f.Package = &sessions.PackageChoice{Bought: bought(title.Package)}
	}
	if renamed || changed(title.Place == before.Place) {
		// No place means the client's usual one, so another client may
		// mean another place.
		c, err := clients.Clients.Get(tx, clientID)
		if err != nil {
			return sessions.Fields{}, err
		}
		loc := locationOf(title.Place, c.HomeVisits)
		f.Location = &loc
	}
	return f, nil
}

func newFollowUp(tx *txn.Tx, e calendar.Event) error {
	f, err := followUpFields(tx, e, nil)
	if err != nil {
		return err
	}
	fu, err := followups.Create(tx, f, "")
	if err != nil {
		return err
	}
	return Links.Add(tx, &Link{EventID: e.ID, Kind: KindFollowUp, ItemID: fu.ID, Seen: shows(KindFollowUp, e)})
}

func followUpChanged(tx *txn.Tx, l *Link, e calendar.Event) error {
	if e.Cancelled {
		if err := followups.Delete(tx, l.ItemID); err != nil {
			return err
		}
		return Links.Delete(tx, e.ID)
	}
	now := shows(KindFollowUp, e)
	if now.Same(l.Seen) {
		return nil
	}
	if !IsFollowUp(e) {
		return apperr.Refused(`This event shows a follow-up, so its title starts with !, like "! Jane: call back".`)
	}
	f, err := followUpFields(tx, e, &l.Seen)
	if err != nil {
		return err
	}
	if _, err := followups.Update(tx, l.ItemID, f); err != nil {
		return err
	}
	l.Seen = now
	return nil
}

// followUpFields are what a follow-up's event says it is; the client only
// when its name changed (seen nil: always).
func followUpFields(tx *txn.Tx, e calendar.Event, seen *calendar.Snapshot) (followups.Fields, error) {
	title, err := calendar.ParseFollowUp(e.Title)
	if err != nil {
		return followups.Fields{}, apperr.Refused(fmt.Sprintf("The title %q can't be read: %v.", e.Title, err))
	}
	f := followups.Fields{Summary: &title.Summary, Notes: &e.Description, When: &followups.When{}}
	if seen == nil || !sameFollowUpName(title.Name, seen.Title) {
		c, err := clients.Match(tx, title.Name)
		if err != nil {
			return followups.Fields{}, err
		}
		f.ClientID = &c.ID
	}
	if e.AllDay {
		f.When.Date = e.Date
	} else {
		start := e.Start.UTC()
		f.When.Start, f.When.Minutes = &start, max(int(e.End.Sub(e.Start)/time.Minute), 1)
	}
	return f, nil
}

func sameFollowUpName(name, seenTitle string) bool {
	before, err := calendar.ParseFollowUp(seenTitle)
	return err == nil && clients.Normalize(before.Name) == clients.Normalize(name)
}

func bought(p *calendar.PackageSpec) *packages.Bought {
	if p == nil {
		return nil
	}
	return &packages.Bought{Hours: p.Hours, PriceCents: p.PriceCents}
}

func sameFee(a, b *int64) bool {
	return (a == nil && b == nil) || (a != nil && b != nil && *a == *b)
}

func samePackage(a, b *calendar.PackageSpec) bool {
	return (a == nil && b == nil) || (a != nil && b != nil && *a == *b)
}

func capitalize(s string) string {
	if s == "" {
		return s
	}
	return string(s[0]-'a'+'A') + s[1:]
}
