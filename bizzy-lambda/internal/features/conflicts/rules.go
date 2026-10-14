package conflicts

import "bizzy-lambda/internal/platform/statemodel"

// ReasonFix: an edit made in a Google app waits for her.
const ReasonFix statemodel.Reason = "fix"

// Rules is the conflict's rule table. Every conflict is on the to-do list:
// it is the calendar saying something bizzy doesn't, until she settles it.
// Its quick actions are its violations' remedies (see View), then these.
var Rules = statemodel.Rules[State]{
	{
		ID: "edit-not-applied", Bucket: statemodel.Contradiction, Reason: ReasonFix,
		Why:  "She changed or deleted an event in the calendar in a way bizzy doesn't allow",
		When: func(s State) bool { return s.Kind != KindNew && s.Ready == Blocked },
		// Undo it there by writing the item back, or apply it once a
		// remedy has made it allowed.
		ResolvedBy: []string{"calendar.revert", "conflicts.apply"},
	},
	{
		ID: "edit-ready", Bucket: statemodel.Contradiction, Reason: ReasonFix,
		Why: "An edit she made in the calendar is allowed now: something done since lets it through, maybe for " +
			"another reason, so it waits for her to apply it rather than applying by itself",
		When:       func(s State) bool { return s.Kind != KindNew && s.Ready == ReadyYes },
		ResolvedBy: []string{"conflicts.apply", "calendar.revert"},
	},
	{
		ID: "event-not-read", Bucket: statemodel.Contradiction, Reason: ReasonFix,
		Why:        "A new event in the calendar can't be read as a session or follow-up",
		When:       func(s State) bool { return s.Kind == KindNew },
		ResolvedBy: []string{"calendar.ignore", "conflicts.apply"},
	},

	{
		ID: "new-with-target", Bucket: statemodel.Impossible,
		Why:            "A new record shows nothing of bizzy's yet, and a known one always does",
		When:           func(s State) bool { return (s.Kind == KindNew) == (s.Target == TargetSome) },
		ByConstruction: "the sync keys a conflict by what the record showed when she changed it",
	},
	{
		ID: "new-ready", Bucket: statemodel.Impossible,
		Why:            "A new event is read as soon as nothing refuses it",
		When:           func(s State) bool { return s.Kind == KindNew && s.Ready == ReadyYes },
		ByConstruction: "the sync applies a new event whenever it reads it (googlesync's try)",
	},
}
