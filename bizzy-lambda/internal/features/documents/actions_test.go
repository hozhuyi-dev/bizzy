package documents_test

import (
	"testing"
	"time"

	"bizzy-lambda/internal/features/documents"
	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/testutil/testapp"
)

// setup is the app with Jane (usual fee RM 90) and three sessions of hers
// that have happened, each on a draft invoice of its own.
func setup(t *testing.T) (*testapp.App, string, []sessions.View) {
	t.Helper()
	a := testapp.New()
	jane, err := a.Client("Jane Smith", map[string]any{"fee": map[string]any{"cents": 9000}})
	if err != nil {
		t.Fatal(err)
	}
	var out []sessions.View
	for _, hour := range []int{-48, -24, -4} {
		start := testapp.Epoch.Add(time.Duration(hour) * time.Hour)
		var s sessions.View
		in := map[string]any{"clientId": jane, "time": map[string]any{"start": start, "end": start.Add(time.Hour)}}
		if err := a.Must("sessions.create", in, &s); err != nil {
			t.Fatal(err)
		}
		out = append(out, s)
	}
	return a, jane, out
}

func session(t *testing.T, a *testapp.App, id string) sessions.View {
	t.Helper()
	var s sessions.FullView
	if err := a.Must("sessions.get", map[string]any{"id": id}, &s); err != nil {
		t.Fatal(err)
	}
	return s.View
}

func listed(t *testing.T, a *testapp.App, clientID string) []documents.Summary {
	t.Helper()
	var out []documents.Summary
	if err := a.Must("documents.listByClient", map[string]any{"clientId": clientID}, &out); err != nil {
		t.Fatal(err)
	}
	return out
}

func refusal(t *testing.T, a *testapp.App, action string, in any) *apperr.Remedy {
	t.Helper()
	before := string(a.Table.Dump())
	_, refused, err := a.Call(action, in)
	switch {
	case err != nil:
		t.Fatal(err)
	case refused == nil || refused.Code != apperr.CodeRefused:
		t.Fatalf("%s: refused = %+v, want a refusal", action, refused)
	case string(a.Table.Dump()) != before:
		t.Fatalf("%s was refused but wrote", action)
	}
	if len(refused.Remedies) == 0 {
		return nil
	}
	return &refused.Remedies[0]
}

func TestCombinePutsSessionsOnOneInvoice(t *testing.T) {
	a, jane, ss := setup(t)
	var d documents.View
	ids := []string{ss[0].Invoice.ID, ss[1].Invoice.ID, ss[2].Invoice.ID}
	if err := a.Must("documents.combine", map[string]any{"ids": ids}, &d); err != nil {
		t.Fatal(err)
	}
	if d.ID != ids[0] || len(d.Draft.Lines) != 3 || d.TotalCents != 27000 {
		t.Errorf("combined: %+v", d.Summary)
	}
	for _, s := range ss {
		if got := session(t, a, s.ID).Invoice; got == nil || got.ID != ids[0] {
			t.Errorf("session %s is on %+v, want %s", s.ID, got, ids[0])
		}
	}
	if docs := listed(t, a, jane); len(docs) != 1 {
		t.Errorf("Jane has %d documents, want the one", len(docs))
	}

	// One goes back on its own.
	if err := a.Must("documents.place", map[string]any{"type": "invoice", "into": "", "items": []map[string]any{{"kind": "session", "id": ss[2].ID}}}, &d); err != nil {
		t.Fatal(err)
	}
	if got := session(t, a, ss[2].ID).Invoice; got == nil || got.ID == ids[0] || got.ID != d.ID {
		t.Errorf("placed on its own: %+v", got)
	}
	// An issued invoice keeps what it covers.
	if err := a.Must("documents.issue", map[string]any{"id": d.ID}, nil); err != nil {
		t.Fatal(err)
	}
	if r := refusal(t, a, "documents.place", map[string]any{"type": "invoice", "into": ids[0], "items": []map[string]any{{"kind": "session", "id": ss[2].ID}}}); r == nil || r.Action != "documents.cancel" {
		t.Errorf("remedy = %+v, want cancelling it", r)
	}
	if r := refusal(t, a, "documents.combine", map[string]any{"ids": []string{ids[0], d.ID}}); r == nil || r.Action != "documents.cancel" {
		t.Errorf("remedy = %+v, want cancelling it", r)
	}
}

func TestDraftGoesWithWhatItCovers(t *testing.T) {
	a, jane, ss := setup(t)
	if err := a.Must("documents.combine", map[string]any{"ids": []string{ss[0].Invoice.ID, ss[1].Invoice.ID}}, nil); err != nil {
		t.Fatal(err)
	}
	var d documents.View
	if err := a.Must("documents.get", map[string]any{"id": ss[0].Invoice.ID}, &d); err != nil {
		t.Fatal(err)
	}
	// A line the user added stays while it covers a session…
	content := *d.Draft
	content.Lines = append(content.Lines, documents.Line{Description: "Tape", AmountCents: 1500})
	if err := a.Must("documents.saveDraft", map[string]any{"id": d.ID, "content": content}, nil); err != nil {
		t.Fatal(err)
	}
	if err := a.Must("sessions.cancel", map[string]any{"id": ss[0].ID}, nil); err != nil {
		t.Fatal(err)
	}
	if docs := listed(t, a, jane); len(docs) != 2 || docs[0].TotalCents+docs[1].TotalCents != 9000+1500+9000 {
		t.Errorf("after cancelling one: %+v", docs)
	}
	// …and goes with the last one.
	if err := a.Must("sessions.cancel", map[string]any{"id": ss[1].ID}, nil); err != nil {
		t.Fatal(err)
	}
	if docs := listed(t, a, jane); len(docs) != 1 || docs[0].ID != ss[2].Invoice.ID {
		t.Errorf("after cancelling both: %+v", docs)
	}
}

func TestMovedLinesTakeWhatIsLeft(t *testing.T) {
	a, _, ss := setup(t)
	var d documents.View
	if err := a.Must("documents.get", map[string]any{"id": ss[0].Invoice.ID}, &d); err != nil {
		t.Fatal(err)
	}
	content := *d.Draft
	content.Lines = append(content.Lines, documents.Line{Description: "Tape", AmountCents: 1500})
	if err := a.Must("documents.saveDraft", map[string]any{"id": d.ID, "content": content}, &d); err != nil {
		t.Fatal(err)
	}
	// Only the line the user added can't start a draft of its own.
	tape := d.Draft.Lines[1].ID
	refusal(t, a, "documents.moveLines", map[string]any{"from": d.ID, "lineIds": []string{tape}})
	// Moving the session's line takes the tape with it.
	in := map[string]any{"from": d.ID, "to": ss[1].Invoice.ID, "lineIds": []string{d.Draft.Lines[0].ID}}
	if err := a.Must("documents.moveLines", in, nil); err != nil {
		t.Fatal(err)
	}
	if err := a.Must("documents.get", map[string]any{"id": ss[1].Invoice.ID}, &d); err != nil {
		t.Fatal(err)
	}
	if len(d.Draft.Lines) != 3 || d.TotalCents != 9000+9000+1500 {
		t.Errorf("moved onto: %+v", d.Draft.Lines)
	}
}

func TestReceiptKeepsALineForWhatWasPaid(t *testing.T) {
	a, _, ss := setup(t)
	paid := map[string]any{"items": []map[string]any{{"kind": "session", "id": ss[0].ID}}, "payment": map[string]any{"method": "cash"}}
	if err := a.Must("payments.set", paid, nil); err != nil {
		t.Fatal(err)
	}
	receipt := session(t, a, ss[0].ID).Paid.ReceiptID
	var d documents.View
	if err := a.Must("documents.get", map[string]any{"id": receipt}, &d); err != nil {
		t.Fatal(err)
	}
	content := *d.Draft
	content.Lines = []documents.Line{{Description: "Thanks", AmountCents: 100}}
	if r := refusal(t, a, "documents.saveDraft", map[string]any{"id": receipt, "content": content}); r == nil || r.Action != "documents.discardDraft" {
		t.Errorf("remedy = %+v, want discarding the draft", r)
	}
}
