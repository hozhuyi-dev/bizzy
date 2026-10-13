package clients

import "bizzy-lambda/internal/platform/statemodel"

// Rules is the client's rule table. A client puts nothing on the to-do
// list yet.
var Rules = statemodel.Rules[State]{
	{
		ID: "own-name-not-an-alias", Bucket: statemodel.Impossible,
		Why:       "The calendar is matched on aliases, so the client's own name must be one",
		When:      func(s State) bool { return s.OwnAlias == OwnAliasNo },
		GuardedBy: []string{"clients.save"},
	},
}
