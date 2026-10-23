// Package todo is the user's to-do list: everything that needs the user,
// from every feature, in one list. Sessions to confirm or record are
// listed as open by sessions; what is owed, by documents (an invoice link
// no receipt pays); follow-ups due, by followups; edits waiting, by
// conflicts. It only reads; each item says what settles it.
package todo

import (
	"cmp"
	"slices"

	"bizzy-lambda/internal/features/conflicts"
	"bizzy-lambda/internal/features/documents"
	"bizzy-lambda/internal/features/followups"
	"bizzy-lambda/internal/features/packages"
	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/features/settings"
	"bizzy-lambda/internal/platform/txn"
)

// Kind is what a to-do item is about.
type Kind string

const (
	KindSession  Kind = "session"
	KindPackage  Kind = "package"
	KindFollowUp Kind = "followUp"
	KindConflict Kind = "conflict"
)

// List is everything that needs the user as of now, oldest first: a
// session or follow-up a few days ahead (see settings), the rest once
// due.
func List(tx *txn.Tx, used packages.Usage) ([]View, error) {
	cfg, err := settings.Get(tx)
	if err != nil {
		return nil, err
	}
	now := tx.Now()
	out := []View{}
	listed := map[string]bool{}
	addSession := func(s *sessions.Session) error {
		if listed[s.ID] {
			return nil
		}
		listed[s.ID] = true
		v, err := sessions.ViewOf(tx, s)
		if err != nil || len(v.Todo) == 0 {
			return err
		}
		out = append(out, View{Kind: KindSession, At: s.Start, Session: &v})
		return nil
	}

	open, err := sessions.Sessions.Open(tx)
	if err != nil {
		return nil, err
	}
	for _, s := range open {
		if !s.Start.After(now.AddDate(0, 0, cfg.ConfirmAheadDays)) {
			if err := addSession(s); err != nil {
				return nil, err
			}
		}
	}
	owed, err := documents.Owed(tx)
	if err != nil {
		return nil, err
	}
	for _, src := range owed {
		switch src.Kind {
		case documents.SourceSession:
			if s, ok, err := sessions.Sessions.Find(tx, src.ID); err != nil {
				return nil, err
			} else if ok {
				if err := addSession(s); err != nil {
					return nil, err
				}
			}
		case documents.SourcePackage:
			p, ok, err := packages.Packages.Find(tx, src.ID)
			if err != nil {
				return nil, err
			}
			switch {
			case !ok:
			case p.BoughtIn != "":
				// Collected with the session it was bought in.
				if s, ok, err := sessions.Sessions.Find(tx, p.BoughtIn); err != nil {
					return nil, err
				} else if ok {
					if err := addSession(s); err != nil {
						return nil, err
					}
				}
			default:
				v, err := packages.ViewOf(tx, p, used)
				if err != nil {
					return nil, err
				}
				if len(v.Todo) > 0 {
					out = append(out, View{Kind: KindPackage, At: p.PurchasedAt, Package: &v})
				}
			}
		}
	}
	due, err := followups.FollowUps.Open(tx)
	if err != nil {
		return nil, err
	}
	for _, fu := range due {
		if len(fu.Todo(now, cfg.FollowUpAheadDays)) == 0 {
			continue
		}
		v, err := followups.ViewOf(tx, fu)
		if err != nil {
			return nil, err
		}
		out = append(out, View{Kind: KindFollowUp, At: fu.Due, FollowUp: &v})
	}
	waiting, err := conflicts.Conflicts.Open(tx)
	if err != nil {
		return nil, err
	}
	for _, c := range waiting {
		v := conflicts.ViewOf(c)
		out = append(out, View{Kind: KindConflict, At: c.Since, Conflict: &v})
	}
	slices.SortStableFunc(out, func(a, b View) int { return cmp.Or(a.At.Compare(b.At), cmp.Compare(a.Kind, b.Kind)) })
	return out, nil
}
