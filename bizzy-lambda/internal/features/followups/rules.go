package followups

import "bizzy-lambda/internal/platform/statemodel"

// ReasonFix: its title can't be read or matched to a client.
const ReasonFix statemodel.Reason = "fix"

// Rules is the follow-up's rule table. An open follow-up is on the to-do
// list once due whatever its reasons: following up is the task. The rules
// add what must be fixed first.
var Rules = statemodel.Rules[State]{
	{
		ID: "title-unreadable", Bucket: statemodel.Contradiction, Reason: ReasonFix,
		Why:        "The calendar title can't be read",
		When:       func(s State) bool { return s.Done == Open && s.Title == TitleUnreadable },
		ResolvedBy: []string{"followUps.update"},
	},
	{
		ID: "client-unmatched", Bucket: statemodel.Contradiction, Reason: ReasonFix,
		Why: "No client has the name in the title",
		When: func(s State) bool {
			return s.Done == Open && (s.Title == TitleNearMiss || s.Title == TitleUnmatched)
		},
		ResolvedBy: []string{"followUps.update", "clients.save"},
	},
}

// Todo is what must be fixed on the follow-up; nil when nothing.
func (f FollowUp) Todo() []statemodel.Reason {
	return Rules.Reasons(f.State())
}
