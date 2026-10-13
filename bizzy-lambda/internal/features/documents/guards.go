package documents

import "bizzy-lambda/internal/platform/apperr"

// Guards are the preconditions of the document's lifecycle steps, in one
// place: the service calls them, and the rules (rules.go, and the links in
// internal/integrity) name the steps whose guards keep them from breaking.

// CanIssue reports whether the draft can be issued: there is one, and
// everything it covers still belongs to the client it is for. owners maps
// each source the draft still has a line for to its client now; the
// calendar may have moved one since the draft was made.
func (d Document) CanIssue(owners map[Source]string) error {
	if d.Draft == nil {
		return apperr.Conflict("there is nothing to issue")
	}
	for _, src := range d.Sources {
		owner, ok := owners[src]
		if !ok || owner == d.ClientID {
			continue
		}
		what := "a session"
		if src.Kind == SourcePackage {
			what = "a package"
		}
		if d.Number == "" {
			return apperr.Conflict("%s on this %s now belongs to another client. Discard the draft and start again from the session.", what, d.Type)
		}
		return apperr.Conflict("%s on this %s now belongs to another client. Cancel %s and make a new one.", what, d.Type, d.Number)
	}
	return nil
}

// CanRevise reports whether an issued document can be opened for editing.
func (d Document) CanRevise() error {
	if d.Status != StatusIssued || d.Draft != nil {
		return apperr.Conflict("only an issued document can be revised")
	}
	return nil
}

// CanDiscardDraft reports whether there is a draft to throw away.
func (d Document) CanDiscardDraft() error {
	if d.Draft == nil {
		return apperr.Conflict("there is no draft to discard")
	}
	return nil
}

// CanCancel reports whether the document can be voided.
func (d Document) CanCancel() error {
	if d.Status != StatusIssued {
		return apperr.Conflict("only an issued document can be cancelled; discard a draft instead")
	}
	return nil
}
