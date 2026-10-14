package followups

import "bizzy-lambda/internal/platform/statemodel"

// ReasonFollowUp: get back to the client.
const ReasonFollowUp statemodel.Reason = "followUp"

// Rules is the follow-up's rule table. An open follow-up is on the to-do
// list once due (the list reads a few days ahead). It has no
// contradictions: a calendar edit that isn't allowed waits as a conflict
// (see internal/features/conflicts), and its client is always one of hers.
var Rules = statemodel.Rules[State]{
	{
		ID: "open", Bucket: statemodel.NeedsAction, Reason: ReasonFollowUp,
		Why:        "Not done yet",
		When:       func(s State) bool { return s.Done == Open },
		ResolvedBy: []string{"followUps.setDone", "followUps.delete"},
	},
}

// Todo is what to do on the follow-up; nil when nothing.
func (f FollowUp) Todo() []statemodel.Reason {
	return Rules.Reasons(f.State())
}
