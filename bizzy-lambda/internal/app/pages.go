package app

import (
	"context"

	"bizzy-lambda/internal/features/conflicts"
	"bizzy-lambda/internal/features/followups"
	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/platform/router"
	"bizzy-lambda/internal/platform/txn"
)

// A page's queries are one call when its parts come from features that
// can't import each other: the app composes them here, in one read.

// SessionPageView is a session's page: the session, the calendar edits
// waiting on it, and the follow-ups made from it.
type SessionPageView struct {
	Session   sessions.FullView `json:"session"`
	Conflicts []conflicts.View  `json:"conflicts"`
	FollowUps []followups.View  `json:"followUps"`
}

type idRequest struct {
	ID string `json:"id"`
}

func pageRoutes(r *router.Router, run *txn.Runner) {
	r.Query("sessions.page", router.Typed(func(ctx context.Context, in idRequest) (any, error) {
		return txn.Read(ctx, run, func(tx *txn.Tx) (SessionPageView, error) {
			var v SessionPageView
			var err error
			if v.Session, err = sessions.Full(tx, in.ID); err != nil {
				return v, err
			}
			if v.Conflicts, err = conflicts.ByTarget(tx, in.ID); err != nil {
				return v, err
			}
			v.FollowUps, err = followups.BySession(tx, in.ID)
			return v, err
		})
	}))
}
