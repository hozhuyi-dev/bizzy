package book

import (
	"fmt"
	"strings"
	"time"

	"bizzy-lambda/internal/features/calendar"
	"bizzy-lambda/internal/features/conflicts"
	"bizzy-lambda/internal/features/followups"
	"bizzy-lambda/internal/platform/apperr"
)

// FollowUpDraft is a follow-up as she fills it in, or as its event says.
type FollowUpDraft struct {
	ClientID string `json:"clientId"`
	// Date (YYYY-MM-DD) makes it an all-day reminder; otherwise Start is
	// when it is due.
	Date  string     `json:"date,omitempty"`
	Start *time.Time `json:"start,omitempty"`
	// Minutes is how long a timed one blocks in the calendar; 0 keeps what
	// it had, or followups.DefaultMinutes.
	Minutes int    `json:"minutes,omitempty"`
	Summary string `json:"summary"`
	Notes   string `json:"notes"`
}

func (d FollowUpDraft) check(b *Book) error {
	if _, err := b.Client(d.ClientID); err != nil {
		return err
	}
	switch {
	case d.Date == "" && d.Start == nil:
		return apperr.Invalid("choose when to follow up")
	case d.Minutes < 0 || time.Duration(d.Minutes)*time.Minute > maxSession:
		return apperr.Invalid("a follow-up blocks at most 12 hours")
	}
	if d.Date != "" {
		if _, err := time.ParseInLocation(time.DateOnly, d.Date, b.Location); err != nil {
			return apperr.Invalid("the date must be YYYY-MM-DD")
		}
	}
	return nil
}

func (d FollowUpDraft) applyTo(b *Book, f *followups.FollowUp) {
	f.ClientID = d.ClientID
	f.Summary = strings.Join(strings.Fields(d.Summary), " ")
	f.Notes = d.Notes
	if d.Date != "" {
		day, _ := time.ParseInLocation(time.DateOnly, d.Date, b.Location)
		f.Due, f.AllDay, f.Minutes = day.UTC(), true, 0
		return
	}
	f.Due, f.AllDay = d.Start.UTC(), false
	switch {
	case d.Minutes > 0:
		f.Minutes = d.Minutes
	case f.Minutes == 0:
		f.Minutes = followups.DefaultMinutes
	}
}

// CreateFollowUp makes a follow-up: in the app (often from a session), or
// from a new `!` event in the calendar.
type CreateFollowUp struct {
	FollowUpDraft
	// SessionID is the session it is made from, if any.
	SessionID string `json:"sessionId,omitempty"`
	// ID is the new follow-up's.
	ID      string          `json:"-"`
	Event   *calendar.Event `json:"-"`
	Problem *Problem        `json:"-"`
}

func (CreateFollowUp) Action() string { return "followUps.create" }

func (c CreateFollowUp) Scope() Scope {
	s := Scope{Clients: []string{c.ClientID}}
	if c.SessionID != "" {
		s.Sessions = []string{c.SessionID}
	}
	return s
}

func (c CreateFollowUp) Apply(b *Book) error {
	if c.Problem != nil {
		b.problem(Key("followUp", c.ID), *c.Problem)
		return nil
	}
	if err := c.check(b); err != nil {
		return b.unreadable(Key("followUp", c.ID), c.Event, true, err)
	}
	f := &followups.FollowUp{ID: c.ID, CreatedAt: b.Now.UTC()}
	c.applyTo(b, f)
	if s, ok := b.Sessions[c.SessionID]; ok && s.ClientID == f.ClientID {
		f.SessionID = s.ID
	} else if c.SessionID != "" {
		return apperr.Invalid("a follow-up from a session is for its client")
	}
	if e := c.Event; e != nil {
		snap := calendar.NotedSnapshotOf(*e)
		f.Event = calendar.Link{EventID: e.ID, Seen: &snap}
		b.Effects.Externals = append(b.Effects.Externals, conflicts.External{
			Surface: conflicts.SurfaceCalendar, ExternalID: e.ID, Kind: conflicts.ShowsFollowUp, ID: f.ID,
		})
		b.Effects.ConflictsGone = append(b.Effects.ConflictsGone, conflicts.Key(conflicts.SurfaceCalendar, e.ID))
	}
	b.FollowUps[f.ID] = f
	b.checkFollowUpWritable(f)
	return nil
}

// UpdateFollowUp changes a follow-up to what she filled in. From the
// calendar, it is what her edit to the event asks for.
type UpdateFollowUp struct {
	ID string `json:"id"`
	FollowUpDraft
	FromCalendar bool               `json:"-"`
	Seen         *calendar.Snapshot `json:"-"`
	Problem      *Problem           `json:"-"`
}

func (UpdateFollowUp) Action() string { return "followUps.update" }

func (c UpdateFollowUp) Scope() Scope {
	return Scope{FollowUps: []string{c.ID}, Clients: []string{c.ClientID}}
}

func (c UpdateFollowUp) Apply(b *Book) error {
	f, err := b.FollowUp(c.ID)
	if err != nil {
		return err
	}
	if c.Problem != nil {
		b.problem(Key("followUp", f.ID), *c.Problem)
		return nil
	}
	if err := c.check(b); err != nil {
		if c.FromCalendar {
			return b.unreadable(Key("followUp", f.ID), &calendar.Event{ID: f.Event.EventID}, true, err)
		}
		return err
	}
	c.applyTo(b, f)
	if s, ok := b.Sessions[f.SessionID]; ok && s.ClientID != f.ClientID {
		// Another client's now: no longer about that session.
		f.SessionID = ""
	}
	if c.FromCalendar {
		f.Event.Seen = c.Seen
		b.Effects.ConflictsGone = append(b.Effects.ConflictsGone, conflicts.Key(conflicts.SurfaceCalendar, f.Event.EventID))
	} else {
		b.Effects.Rebooked = append(b.Effects.Rebooked, f.ID)
	}
	b.checkFollowUpWritable(f)
	return nil
}

// DeleteFollowUp deletes a follow-up: in the app, or by deleting its event
// in the calendar.
type DeleteFollowUp struct {
	ID           string `json:"id"`
	FromCalendar bool   `json:"-"`
}

func (DeleteFollowUp) Action() string { return "followUps.delete" }

func (c DeleteFollowUp) Scope() Scope { return Scope{FollowUps: []string{c.ID}} }

func (c DeleteFollowUp) Apply(b *Book) error {
	f, err := b.FollowUp(c.ID)
	if err != nil {
		return err
	}
	delete(b.FollowUps, f.ID)
	if id := f.Event.EventID; id != "" {
		b.Effects.ExternalsGone = append(b.Effects.ExternalsGone, id)
		b.Effects.ConflictsGone = append(b.Effects.ConflictsGone, conflicts.Key(conflicts.SurfaceCalendar, id))
		if !c.FromCalendar {
			b.Effects.EventsGone = append(b.Effects.EventsGone, id)
		}
	}
	return nil
}

// SetFollowUpDone marks a follow-up done, or not done again. It is hers:
// the calendar doesn't show it.
type SetFollowUpDone struct {
	ID   string `json:"id"`
	Done bool   `json:"done"`
}

func (SetFollowUpDone) Action() string { return "followUps.setDone" }

func (c SetFollowUpDone) Scope() Scope { return Scope{FollowUps: []string{c.ID}} }

func (c SetFollowUpDone) Apply(b *Book) error {
	f, err := b.FollowUp(c.ID)
	if err != nil {
		return err
	}
	switch {
	case c.Done && f.DoneAt == nil:
		f.DoneAt = ptr(b.Now.UTC())
	case !c.Done:
		f.DoneAt = nil
	}
	return nil
}

// checkFollowUpWritable records a client whose name can't be written in a
// follow-up's title.
func (b *Book) checkFollowUpWritable(f *followups.FollowUp) {
	if c := b.Clients[f.ClientID]; !FollowUpWritable(WrittenFollowUpName(c, f.Event.Seen)) {
		b.problem(Key("followUp", f.ID), Problem{
			Kind: Unwritable, ClientID: c.ID, EventID: f.Event.EventID, FollowUp: true,
			Text: fmt.Sprintf("%q can't be written in a follow-up's title. Give the client a name without a colon.", c.Name),
		})
	}
}
