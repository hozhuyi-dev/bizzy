package googlesync

import (
	"fmt"
	"time"

	"bizzy-lambda/internal/features/book"
	"bizzy-lambda/internal/features/calendar"
	"bizzy-lambda/internal/features/clients"
	"bizzy-lambda/internal/features/followups"
	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/shared/money"
)

// Reading the calendar: an event is the session or follow-up it shows, as
// she wrote it. A new event is a booking (book.CreateSession) or a
// follow-up (book.CreateFollowUp); a change to one she has is what her
// edit asks for (book.UpdateSession, book.UpdateFollowUp), read against
// what the event said when bizzy and the calendar last agreed (Seen), so
// only what she changed changes: a title still without an amount keeps the
// fee the session has, and the same name keeps its client whatever her
// calendar names are now. They are the commands the app sends, decided by
// the same guards; what a title can't say is the command's Problem, which
// they refuse. An event stays what it shows: a session's can't become a
// follow-up, or the other way round.

// readNew is the booking a new event makes.
func readNew(b *book.Book, id string, e calendar.Event) book.CreateSession {
	cmd := book.CreateSession{ID: id, Event: &e}
	title, err := calendar.ParseTitle(e.Title)
	if err != nil {
		cmd.Problem = &book.Problem{Kind: book.Unreadable, Text: unreadable(e, err), EventID: e.ID}
		return cmd
	}
	clientID, problem := match(b, title.Name, e.ID, false)
	if problem != nil {
		cmd.Problem = problem
		return cmd
	}
	client := b.Clients[clientID]
	cmd.Booking = book.Booking{
		ClientID: clientID, Start: e.Start.UTC(), End: e.End.UTC(), Tentative: title.Tentative,
		Location: book.LocationOf(title.Place, client.HomeVisits),
		FeeCents: title.FeeCents, Package: spec(title.Package),
	}
	return cmd
}

// readChange is the booking her edit to a session's event asks for.
func readChange(b *book.Book, s *sessions.Session, e calendar.Event) book.UpdateSession {
	snap := calendar.SnapshotOf(e)
	draft := b.DraftOf(s)
	cmd := book.UpdateSession{
		ID: s.ID, FromCalendar: true, Seen: &snap,
		Booking: book.Booking{
			ClientID: s.ClientID, Start: e.Start.UTC(), End: e.End.UTC(), Tentative: s.Tentative, Location: s.Location,
			FeeCents: draft.FeeCents, Package: draft.Package,
		},
	}
	if e.AllDay || calendar.IsFollowUp(e.Title) {
		cmd.Problem = &book.Problem{Kind: book.Unreadable, EventID: e.ID,
			Text: "A session's event stays a timed event whose title doesn't start with !. Make a follow-up in the app instead."}
		return cmd
	}
	now, err := calendar.ParseTitle(e.Title)
	if err != nil {
		cmd.Problem = &book.Problem{Kind: book.Unreadable, Text: unreadable(e, err), EventID: e.ID}
		return cmd
	}
	var seen calendar.Snapshot
	if s.Event.Seen != nil {
		seen = *s.Event.Seen
	}
	was, seenErr := calendar.ParseTitle(seen.Title)
	changed := func(same bool) bool { return seenErr != nil || !same }

	if changed(now.Tentative == was.Tentative) {
		cmd.Tentative = now.Tentative
	}
	if changed(clients.NormalizeAlias(now.Name) == clients.NormalizeAlias(was.Name)) {
		clientID, problem := match(b, now.Name, e.ID, false)
		if problem != nil {
			cmd.Problem = problem
			return cmd
		}
		cmd.ClientID = clientID
	}
	if changed(sameFee(now.FeeCents, was.FeeCents)) {
		cmd.FeeCents = now.FeeCents
	}
	if changed(samePackage(now.Package, was.Package)) {
		cmd.Package = spec(now.Package)
	}
	if changed(now.Place == was.Place) || cmd.ClientID != s.ClientID {
		// No place means the client's usual one, so another client may mean
		// another place.
		cmd.Location = book.LocationOf(now.Place, b.Clients[cmd.ClientID].HomeVisits)
	}
	return cmd
}

// readNewFollowUp is the follow-up a new `!` event makes.
func readNewFollowUp(b *book.Book, id string, e calendar.Event) book.CreateFollowUp {
	cmd := book.CreateFollowUp{ID: id, Event: &e}
	title, err := calendar.ParseFollowUp(e.Title)
	if err != nil {
		cmd.Problem = &book.Problem{Kind: book.Unreadable, Text: unreadable(e, err), EventID: e.ID, FollowUp: true}
		return cmd
	}
	clientID, problem := match(b, title.Name, e.ID, true)
	if problem != nil {
		cmd.Problem = problem
		return cmd
	}
	cmd.FollowUpDraft = followUpDraft(clientID, title, e)
	return cmd
}

// readFollowUpChange is what her edit to a follow-up's event asks for.
func readFollowUpChange(b *book.Book, f *followups.FollowUp, e calendar.Event) book.UpdateFollowUp {
	snap := calendar.NotedSnapshotOf(e)
	cmd := book.UpdateFollowUp{ID: f.ID, FromCalendar: true, Seen: &snap}
	now, err := calendar.ParseFollowUp(e.Title)
	if err != nil {
		cmd.Problem = &book.Problem{Kind: book.Unreadable, EventID: e.ID, FollowUp: true,
			Text: unreadable(e, err) + " A follow-up's title starts with !"}
		return cmd
	}
	clientID := f.ClientID
	var seen calendar.Snapshot
	if f.Event.Seen != nil {
		seen = *f.Event.Seen
	}
	was, seenErr := calendar.ParseFollowUp(seen.Title)
	if seenErr != nil || clients.NormalizeAlias(now.Name) != clients.NormalizeAlias(was.Name) {
		var problem *book.Problem
		if clientID, problem = match(b, now.Name, e.ID, true); problem != nil {
			cmd.Problem = problem
			return cmd
		}
	}
	cmd.FollowUpDraft = followUpDraft(clientID, now, e)
	return cmd
}

// followUpDraft is what a follow-up's event says it is.
func followUpDraft(clientID string, title calendar.FollowUpTitle, e calendar.Event) book.FollowUpDraft {
	d := book.FollowUpDraft{ClientID: clientID, Summary: title.Summary, Notes: e.Description}
	if e.AllDay {
		d.Date = e.Date
		return d
	}
	start := e.Start.UTC()
	d.Start, d.Minutes = &start, max(int(e.End.Sub(e.Start)/time.Minute), 1)
	return d
}

// match is the client a title's name means, or why none.
func match(b *book.Book, name, eventID string, followUp bool) (string, *book.Problem) {
	all := make([]clients.Client, 0, len(b.Clients))
	for _, id := range book.SortedIDs(b.Clients) {
		all = append(all, b.Clients[id])
	}
	m := clients.MatchName(name, clients.AliasesOf(all))
	if m.Kind == clients.MatchExact {
		return m.ClientID, nil
	}
	p := &book.Problem{Kind: book.Unmatched, Name: name, EventID: eventID, FollowUp: followUp, Text: fmt.Sprintf("No client is called %q.", name)}
	if m.Kind == clients.MatchNearMiss {
		p.Suggested = m.ClientID
		p.Text = fmt.Sprintf("No client is called %q. Did you mean %s?", name, b.Clients[m.ClientID].Name)
	}
	return "", p
}

func unreadable(e calendar.Event, err error) string {
	return fmt.Sprintf("The title %q can't be read: %s.", e.Title, err)
}

func spec(p *calendar.PackageSpec) *book.PackageSpec {
	if p == nil {
		return nil
	}
	return &book.PackageSpec{Sessions: p.Sessions, PriceCents: p.PriceCents}
}

func sameFee(a, b *int64) bool {
	return (a == nil && b == nil) || (a != nil && b != nil && *a == *b)
}

func samePackage(a, b *calendar.PackageSpec) bool {
	return (a == nil && b == nil) || (a != nil && b != nil && *a == *b)
}

// asks says in words what a command asks, for a conflict.
func asks(b *book.Book, cmd book.Command) []string {
	switch c := cmd.(type) {
	case book.CreateSession:
		if c.Event != nil {
			return []string{fmt.Sprintf("A new session: %q", c.Event.Title)}
		}
	case book.CreateFollowUp:
		if c.Event != nil {
			return []string{fmt.Sprintf("A new follow-up: %q", c.Event.Title)}
		}
	case book.DeleteSession:
		return []string{"Delete the session"}
	case book.DeleteFollowUp:
		return []string{"Delete the follow-up"}
	case book.UpdateFollowUp:
		f, ok := b.FollowUps[c.ID]
		if !ok {
			return nil
		}
		var out []string
		if c.Problem != nil && c.Seen != nil {
			out = append(out, fmt.Sprintf("Title: %q", c.Seen.Title))
			return out
		}
		if c.ClientID != f.ClientID {
			out = append(out, "For "+b.Clients[c.ClientID].Name)
		}
		if c.Summary != f.Summary {
			out = append(out, fmt.Sprintf("Summary: %q", c.Summary))
		}
		return append(out, "As the event says")
	case book.UpdateSession:
		s, ok := b.Sessions[c.ID]
		if !ok {
			return nil
		}
		var out []string
		if c.Problem != nil && c.Seen != nil {
			out = append(out, fmt.Sprintf("Title: %q", c.Seen.Title))
		}
		if !c.Start.Equal(s.Start) || !c.End.Equal(s.End) {
			out = append(out, "Move to "+c.Start.In(b.Location).Format("Mon 2 Jan, 3:04pm"))
		}
		if c.ClientID != s.ClientID {
			out = append(out, "For "+b.Clients[c.ClientID].Name)
		}
		switch {
		case c.Tentative && !s.Tentative:
			out = append(out, "Not confirmed yet")
		case !c.Tentative && s.Tentative:
			out = append(out, "Confirm it")
		}
		draft := b.DraftOf(s)
		switch {
		case !sameFee(c.FeeCents, draft.FeeCents) && c.FeeCents != nil:
			out = append(out, "Fee "+money.Format(*c.FeeCents))
		case !sameFee(c.FeeCents, draft.FeeCents):
			out = append(out, "Its usual fee or a credit")
		}
		switch p := c.Package; {
		case p == nil && draft.Package != nil:
			out = append(out, "No package bought in it")
		case p != nil && (draft.Package == nil || *p != *draft.Package):
			out = append(out, fmt.Sprintf("Buys %d sessions for %s", p.Sessions, money.Format(p.PriceCents)))
		}
		if c.Location != s.Location {
			out = append(out, map[sessions.Location]string{sessions.LocationVisit: "A home visit", sessions.LocationOwn: "At her place"}[c.Location])
		}
		return out
	}
	return nil
}
