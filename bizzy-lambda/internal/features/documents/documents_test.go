package documents

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"bizzy-lambda/internal/features/clients"
	"bizzy-lambda/internal/features/packages"
	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/platform/dynamo"
	"bizzy-lambda/internal/testutil/memory"
)

func TestNumbering(t *testing.T) {
	date := time.Date(2026, 3, 1, 0, 0, 0, 0, time.UTC)
	tests := []struct {
		template, want, key string
	}{
		{"RCP-{seq:4}", "RCP-0042", "receipt"},
		{"R{YY}-{seq:3}", "R26-042", "receipt#2026"},
		{"{YYYY}/{seq}", "2026/42", "receipt#2026"},
	}
	for _, tt := range tests {
		n := Numbering{Template: tt.template}
		if err := ValidateTemplate(tt.template); err != nil {
			t.Errorf("ValidateTemplate(%q) = %v", tt.template, err)
		}
		if got := n.Format(42, date); got != tt.want {
			t.Errorf("Format(%q) = %q, want %q", tt.template, got, tt.want)
		}
		if got := n.CounterKey(TypeReceipt, date); got != tt.key {
			t.Errorf("CounterKey(%q) = %q, want %q", tt.template, got, tt.key)
		}
	}

	for _, bad := range []string{"RCP-0001", "{seq}-{seq}", "{seq} {MM}"} {
		if ValidateTemplate(bad) == nil {
			t.Errorf("ValidateTemplate(%q) should fail", bad)
		}
	}
}

// fakeRepo keeps documents in memory and checks the same guards Commit
// does in DynamoDB.
type fakeRepo struct {
	docs      map[string]Document
	counters  map[string]int64
	revisions []Revision
	links     int
}

func (f *fakeRepo) Get(_ context.Context, id string) (Document, bool, error) {
	d, ok := f.docs[id]
	return d, ok, nil
}

func (f *fakeRepo) ListByType(context.Context, Type) ([]Document, error) { return nil, nil }

func (f *fakeRepo) Revisions(_ context.Context, id string) ([]Revision, error) {
	var out []Revision
	for _, r := range f.revisions {
		if r.DocumentID == id {
			out = append(out, r)
		}
	}
	return out, nil
}

func (f *fakeRepo) Counter(_ context.Context, key string) (int64, error) { return f.counters[key], nil }

func (f *fakeRepo) SetCounter(_ context.Context, key string, last int64) (bool, error) {
	if f.counters[key] > last {
		return false, nil
	}
	f.counters[key] = last
	return true, nil
}

func (f *fakeRepo) Commit(_ context.Context, w Write) error {
	existing, exists := f.docs[w.Doc.ID]
	if (w.PreviousVersion == 0 && exists) || (w.PreviousVersion > 0 && existing.Version != w.PreviousVersion) {
		return dynamo.ErrTransactionConflict
	}
	if c := w.Counter; c != nil {
		if f.counters[c.Key] != c.Prev {
			return dynamo.ErrTransactionConflict
		}
		f.counters[c.Key] = c.Next
	}
	if w.Revision != nil {
		f.revisions = append(f.revisions, *w.Revision)
	}
	f.links += len(w.Links)
	if w.Delete {
		delete(f.docs, w.Doc.ID)
	} else {
		f.docs[w.Doc.ID] = w.Doc
	}
	return nil
}

func newHandler(t *testing.T) (handler, *fakeRepo, *[]string) {
	t.Helper()
	m := memory.New()
	fee := int64(9500)
	m.ClientMap["jane"] = clients.Client{ID: "jane", Name: "Jane Smith"}
	for _, id := range []string{"e1", "e2"} {
		m.SessionMap[id] = sessions.Session{
			EventID: id, ClientID: "jane", Status: sessions.StatusPriced, FeeCents: &fee,
			Start: time.Date(2026, 10, 5, 2, 0, 0, 0, time.UTC),
		}
	}
	m.SettingsVal.BusinessName = "Physio Co"

	repo := &fakeRepo{docs: map[string]Document{}, counters: map[string]int64{}}
	var reconciled []string
	h := handler{Deps{
		Repo:     repo,
		Sessions: m.Sessions(),
		Packages: m.Packages(),
		Clients:  m.Clients(),
		Settings: m.Settings(),
		AfterChange: func(_ context.Context, ids ...string) error {
			reconciled = append(reconciled, ids...)
			return nil
		},
		Location: time.UTC,
		Now:      func() time.Time { return time.Date(2026, 10, 11, 9, 0, 0, 0, time.UTC) },
	}}
	return h, repo, &reconciled
}

// must unwraps a handler's (any, error) result: must[Document](t)(h.issue(…)).
func must[T any](t *testing.T) func(any, error) T {
	return func(v any, err error) T {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
		return v.(T)
	}
}

func TestLifecycle(t *testing.T) {
	ctx := context.Background()
	h, repo, reconciled := newHandler(t)

	draft := must[Document](t)(h.createDraft(ctx, createDraftInput{Type: TypeReceipt, Sources: []Source{{Kind: SourceSession, ID: "e1"}}}))
	if draft.Status != StatusDraft || draft.Number != "" || draft.Draft.TotalCents != 9500 {
		t.Fatalf("draft = %+v", draft)
	}
	if line := draft.Draft.Lines[0]; line.Date != "2026-10-05" || line.Description != "Physiotherapy session" {
		t.Errorf("prefilled line = %+v", line)
	}

	// She edits freely before issuing.
	content := *draft.Draft
	content.Lines[0].AmountCents = 9000
	content.PaidBy = "Cash"
	draft = must[Document](t)(h.saveDraft(ctx, saveDraftInput{ID: draft.ID, Version: draft.Version, Content: content}))

	issued := must[Document](t)(h.issue(ctx, idInput{ID: draft.ID, Version: draft.Version}))
	if issued.Number != "RCP-0001" || *issued.Revision != 0 || issued.Content.TotalCents != 9000 || issued.Draft != nil {
		t.Fatalf("issued = %+v", issued)
	}
	if len(*reconciled) == 0 {
		t.Error("issuing should reconcile the client")
	}

	// Revise: same number, next revision; rev 0 is kept.
	revising := must[Document](t)(h.revise(ctx, idInput{ID: issued.ID, Version: issued.Version}))
	content = *revising.Draft
	content.Recipient.Name = "Jane A. Smith"
	revising = must[Document](t)(h.saveDraft(ctx, saveDraftInput{ID: revising.ID, Version: revising.Version, Content: content}))
	if revising.Content.Recipient.Name != "Jane Smith" {
		t.Error("the issued content must not change while a revision is drafted")
	}
	rev1 := must[Document](t)(h.issue(ctx, idInput{ID: revising.ID, Version: revising.Version}))
	if rev1.Number != "RCP-0001" || *rev1.Revision != 1 || rev1.Content.Recipient.Name != "Jane A. Smith" {
		t.Errorf("rev1 = %+v", rev1)
	}
	if len(repo.revisions) != 2 || repo.revisions[0].Content.Recipient.Name != "Jane Smith" {
		t.Errorf("revisions = %+v", repo.revisions)
	}

	// A discarded draft takes no number.
	other := must[Document](t)(h.createDraft(ctx, createDraftInput{Type: TypeReceipt, Sources: []Source{{Kind: SourceSession, ID: "e2"}}}))
	if _, err := h.discardDraft(ctx, idInput{ID: other.ID, Version: other.Version}); err != nil {
		t.Fatal(err)
	}
	if _, ok := repo.docs[other.ID]; ok {
		t.Error("discarded draft should be deleted")
	}
	next := must[numberingOutput](t)(h.numbering(ctx, typeInput{Type: TypeReceipt}))
	if next.Next != "RCP-0002" {
		t.Errorf("next number = %q, want RCP-0002", next.Next)
	}

	// Cancel keeps the number used.
	cancelled := must[Document](t)(h.cancel(ctx, cancelInput{ID: rev1.ID, Version: rev1.Version, Reason: "session cancelled"}))
	if cancelled.Status != StatusCancelled || cancelled.Number != "RCP-0001" {
		t.Errorf("cancelled = %+v", cancelled)
	}
}

func TestSessionAndItsPackageOnOneReceipt(t *testing.T) {
	ctx := context.Background()
	h, repo, _ := newHandler(t)
	pkgs := h.Packages.(*memory.PackageRepo)
	pkgs.PackageMap["e1"] = packages.Package{
		ID: "e1", ClientID: "jane", Sessions: 10, PriceCents: 85000,
		PurchasedAt: time.Date(2026, 10, 5, 2, 0, 0, 0, time.UTC), Source: packages.SourceCalendar,
	}

	draft := must[Document](t)(h.createDraft(ctx, createDraftInput{Type: TypeReceipt, Sources: []Source{
		{Kind: SourceSession, ID: "e1"},
		{Kind: SourcePackage, ID: "e1"},
	}}))
	if len(draft.Draft.Lines) != 2 || draft.Draft.TotalCents != 94500 || len(draft.Sources) != 2 {
		t.Fatalf("draft = %+v", draft.Draft)
	}
	if repo.links != 2 {
		t.Errorf("links = %d, want both sources reserved", repo.links)
	}
}

func TestOneClientPerDocument(t *testing.T) {
	ctx := context.Background()
	h, _, _ := newHandler(t)
	h.Packages.(*memory.PackageRepo).PackageMap["p"] = packages.Package{ID: "p", ClientID: "bob", Sessions: 1, PriceCents: 1}

	_, err := h.createDraft(ctx, createDraftInput{Type: TypeReceipt, Sources: []Source{
		{Kind: SourceSession, ID: "e1"},
		{Kind: SourcePackage, ID: "p"},
	}})
	var appErr *apperr.Error
	if !errors.As(err, &appErr) || appErr.Code != apperr.CodeInvalid {
		t.Errorf("err = %v, want invalid", err)
	}
}

func TestStaleVersionIsRejected(t *testing.T) {
	ctx := context.Background()
	h, _, _ := newHandler(t)

	draft := must[Document](t)(h.createDraft(ctx, createDraftInput{Type: TypeReceipt, Sources: []Source{{Kind: SourceSession, ID: "e1"}}}))
	if _, err := h.saveDraft(ctx, saveDraftInput{ID: draft.ID, Version: draft.Version, Content: *draft.Draft}); err != nil {
		t.Fatal(err)
	}
	_, err := h.saveDraft(ctx, saveDraftInput{ID: draft.ID, Version: draft.Version, Content: *draft.Draft})
	var appErr *apperr.Error
	if !errors.As(err, &appErr) || appErr.Code != apperr.CodeConflict {
		t.Errorf("stale save error = %v, want conflict", err)
	}
}

func TestNormalizeRejectsForeignSources(t *testing.T) {
	c := Content{
		Date:      "2026-10-11",
		Recipient: Recipient{Name: "Jane"},
		Lines:     []Line{{Description: "x", AmountCents: 1, Source: &Source{Kind: SourceSession, ID: "other"}}},
	}
	_, err := Normalize(c, map[Source]bool{{Kind: SourceSession, ID: "e1"}: true})
	if err == nil || !strings.Contains(err.Error(), "does not cover") {
		t.Errorf("err = %v", err)
	}
}
