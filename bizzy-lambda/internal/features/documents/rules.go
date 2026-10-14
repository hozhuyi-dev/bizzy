package documents

import "bizzy-lambda/internal/platform/statemodel"

// Rules is the document's rule table: the lifecycle in the package comment,
// as what must never happen. A document puts nothing on the to-do list: what
// it covers does (a session to collect, say). What its lines say about the
// items they cover is checked against those items in internal/integrity.
var Rules = statemodel.Rules[State]{
	{
		ID: "draft-without-content", Bucket: statemodel.Impossible,
		Why:            "A never-issued document is its draft",
		When:           func(s State) bool { return s.Status == StatusDraft && s.Editing == EditingNone },
		ByConstruction: "a draft is only deleted, never emptied",
	},
	{
		ID: "number-before-issue", Bucket: statemodel.Impossible,
		Why:            "The number is taken on the first issue, so drafts leave no gaps",
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
}
