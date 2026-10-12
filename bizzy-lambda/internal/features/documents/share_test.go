package documents

import (
	"context"
	"errors"
	"testing"

	"bizzy-lambda/internal/platform/apperr"
)

func issueReceipt(t *testing.T, h handler, eventID string) Document {
	t.Helper()
	ctx := context.Background()
	draft := must[Document](t)(h.createDraft(ctx, createDraftInput{Type: TypeReceipt, Sources: []Source{{Kind: SourceSession, ID: eventID}}}))
	return must[Document](t)(h.issue(ctx, idInput{ID: draft.ID, Version: draft.Version}))
}

func isCode(err error, code apperr.Code) bool {
	var appErr *apperr.Error
	return errors.As(err, &appErr) && appErr.Code == code
}

func TestIssueGivesAShareLink(t *testing.T) {
	ctx := context.Background()
	h, repo, _ := newHandler(t)

	draft := must[Document](t)(h.createDraft(ctx, createDraftInput{Type: TypeReceipt, Sources: []Source{{Kind: SourceSession, ID: "e1"}}}))
	if draft.ShareToken != "" {
		t.Error("a draft must not be shareable")
	}
	issued := must[Document](t)(h.issue(ctx, idInput{ID: draft.ID, Version: draft.Version}))
	if !shareTokenPattern.MatchString(issued.ShareToken) {
		t.Fatalf("share token = %q", issued.ShareToken)
	}

	shared, err := ReadShared(ctx, repo, issued.ShareToken)
	if err != nil {
		t.Fatal(err)
	}
	if shared.Number != "RCP-0001" || shared.Content.Recipient.Name != "Jane Smith" || shared.Status != StatusIssued {
		t.Errorf("shared = %+v", shared)
	}

	// A revision keeps the link, and the link shows the issued content, not
	// the revision being drafted.
	revising := must[Document](t)(h.revise(ctx, idInput{ID: issued.ID, Version: issued.Version}))
	content := *revising.Draft
	content.Recipient.Name = "Someone Else"
	must[Document](t)(h.saveDraft(ctx, saveDraftInput{ID: revising.ID, Version: revising.Version, Content: content}))
	if shared, _ = ReadShared(ctx, repo, issued.ShareToken); shared.Content.Recipient.Name != "Jane Smith" {
		t.Errorf("link shows %q, want the issued content", shared.Content.Recipient.Name)
	}
	rev1 := must[Document](t)(h.issue(ctx, idInput{ID: revising.ID, Version: repo.docs[revising.ID].Version}))
	if rev1.ShareToken != issued.ShareToken {
		t.Error("a revision should keep the link")
	}

	// Cancelled still opens, marked cancelled.
	must[Document](t)(h.cancel(ctx, cancelInput{ID: rev1.ID, Version: rev1.Version}))
	if shared, _ = ReadShared(ctx, repo, issued.ShareToken); shared.Status != StatusCancelled {
		t.Errorf("status = %q, want cancelled", shared.Status)
	}
}

func TestResetShareKillsTheOldLink(t *testing.T) {
	ctx := context.Background()
	h, repo, _ := newHandler(t)
	issued := issueReceipt(t, h, "e1")

	reset := must[Document](t)(h.resetShare(ctx, idInput{ID: issued.ID, Version: issued.Version}))
	if reset.ShareToken == issued.ShareToken {
		t.Fatal("reset should change the token")
	}
	if _, err := ReadShared(ctx, repo, issued.ShareToken); !isCode(err, apperr.CodeNotFound) {
		t.Errorf("old link err = %v, want not found", err)
	}
	if _, err := ReadShared(ctx, repo, reset.ShareToken); err != nil {
		t.Errorf("new link err = %v", err)
	}
}

func TestShareBackfillsOlderDocuments(t *testing.T) {
	ctx := context.Background()
	h, repo, _ := newHandler(t)
	first := issueReceipt(t, h, "e1")
	second := issueReceipt(t, h, "e2")

	// Issued before documents had links.
	old := repo.docs[second.ID]
	delete(repo.shares, old.ShareToken)
	old.ShareToken = ""
	repo.docs[second.ID] = old

	tokens := must[map[string]string](t)(h.share(ctx, shareInput{IDs: []string{first.ID, second.ID}}))
	if tokens[first.ID] != first.ShareToken {
		t.Errorf("first token = %q, want its existing %q", tokens[first.ID], first.ShareToken)
	}
	if _, err := ReadShared(ctx, repo, tokens[second.ID]); err != nil {
		t.Errorf("backfilled link err = %v", err)
	}

	draft := must[Document](t)(h.createDraft(ctx, createDraftInput{Type: TypeReceipt, Sources: []Source{{Kind: SourceSession, ID: "e1"}}}))
	if _, err := h.share(ctx, shareInput{IDs: []string{draft.ID}}); err == nil {
		t.Error("sharing a draft should fail")
	}
}

func TestReadSharedRejectsBadTokens(t *testing.T) {
	ctx := context.Background()
	_, repo, _ := newHandler(t)
	for _, token := range []string{"", "short", "../../etc/passwd", "AAAAAAAAAAAAAAAAAAAAAA"} {
		if _, err := ReadShared(ctx, repo, token); !isCode(err, apperr.CodeNotFound) {
			t.Errorf("ReadShared(%q) err = %v, want not found", token, err)
		}
	}
}

func TestListByClientCoversEveryType(t *testing.T) {
	ctx := context.Background()
	h, repo, _ := newHandler(t)
	issued := issueReceipt(t, h, "e1")
	repo.docs["other"] = Document{ID: "other", Type: "quotation", Status: StatusIssued, ClientID: "jane"}
	repo.docs["bob"] = Document{ID: "bob", Type: TypeReceipt, Status: StatusIssued, ClientID: "bob"}

	list := must[[]Summary](t)(h.listByClient(ctx, clientInput{ClientID: "jane"}))
	if len(list) != 2 {
		t.Fatalf("list = %+v, want Jane's two documents", list)
	}
	for _, s := range list {
		if s.ID == issued.ID && s.ShareToken != issued.ShareToken {
			t.Errorf("summary should carry the share token")
		}
	}
}
