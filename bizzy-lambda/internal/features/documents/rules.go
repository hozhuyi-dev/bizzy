package documents

import "bizzy-lambda/internal/platform/statemodel"

// Rules is the document's rule table: the lifecycle in the package comment,
// as what must never happen. A document puts nothing on the to-do list; a
// calendar change that contradicts one shows on the session (drift).
var Rules = statemodel.Rules[State]{
	{
		ID: "draft-without-content", Bucket: statemodel.Impossible,
		Why:            "A never-issued document is its draft",
		When:           func(s State) bool { return s.Status == StatusDraft && s.Editing == EditingNone },
		ByConstruction: "discarding a never-issued draft deletes the document",
	},
	{
		ID: "number-before-issue", Bucket: statemodel.Impossible,
		Why:            "The number is taken on the first issue, so discarded drafts leave no gaps",
		When:           func(s State) bool { return (s.Status == StatusDraft) == (s.Number == NumberTaken) },
		ByConstruction: "Issue numbers the document as it first issues it",
	},
	{
		ID: "share-before-issue", Bucket: statemodel.Impossible,
		Why:            "A link opens issued content, so it exists once issued",
		When:           func(s State) bool { return (s.Status == StatusDraft) == (s.Share == ShareLink) },
		ByConstruction: "Issue makes the link as it first issues it",
	},
	{
		ID: "cancelled-while-editing", Bucket: statemodel.Impossible,
		Why:            "A cancelled document can't be revised",
		When:           func(s State) bool { return s.Status == StatusCancelled && s.Editing == EditingDraft },
		GuardedBy:      []string{"documents.revise"},
		ByConstruction: "Cancel drops the draft",
	},
	{
		ID: "draft-covers-nothing", Bucket: statemodel.Impossible,
		Why:       "A draft starts from what it covers, and keeps it until issued",
		When:      func(s State) bool { return s.Status == StatusDraft && s.Sources == CoversNothing },
		GuardedBy: []string{"documents.createDraft"},
	},
}
