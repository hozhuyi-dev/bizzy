package documents_test

import (
	"testing"

	"bizzy-lambda/internal/features/documents"
	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/testutil/testapp"
)

func ask(t *testing.T, a *testapp.App, in map[string]any) documents.Ask {
	t.Helper()
	var out documents.Ask
	if err := a.Must("documents.ask", in, &out); err != nil {
		t.Fatal(err)
	}
	return out
}

func itemsOf(s sessions.View) map[string]any { return map[string]any{"items": s.Sources} }

func TestAskingToPay(t *testing.T) {
	a, jane, ss := setup(t)

	// A session on its draft: its own line, the reference its day.
	one := ask(t, a, itemsOf(ss[0]))
	if len(one.Lines) != 1 || one.TotalCents != 9000 || one.Lines[0].Number != "" || one.Ref != "JANE 11OCT" || one.ClientID != jane {
		t.Errorf("one session: %+v", one)
	}
	// Two drafts: each line, the reference the latest day.
	both := ask(t, a, map[string]any{"ids": []string{ss[0].Invoice.ID, ss[1].Invoice.ID}})
	if len(both.Lines) != 2 || both.TotalCents != 18000 || both.Ref != "JANE 12OCT" {
		t.Errorf("two drafts: %+v", both)
	}

	// On one issued invoice: asked for as the invoice, from either session.
	var inv documents.View
	if err := a.Must("documents.combine", map[string]any{"ids": []string{ss[0].Invoice.ID, ss[1].Invoice.ID}}, &inv); err != nil {
		t.Fatal(err)
	}
	if err := a.Must("documents.issue", map[string]any{"id": inv.ID}, &inv); err != nil {
		t.Fatal(err)
	}
	issued := ask(t, a, itemsOf(ss[1]))
	if len(issued.Lines) != 1 || issued.Lines[0].Number != inv.Number || issued.Lines[0].ShareToken == "" ||
		issued.TotalCents != 18000 || issued.Ref != inv.Number {
		t.Errorf("issued: %+v, want %s as a whole", issued, inv.Number)
	}
	// With a draft beside it: both, the reference the client's again.
	mixed := ask(t, a, map[string]any{"ids": []string{inv.ID, ss[2].Invoice.ID}})
	if len(mixed.Lines) != 2 || mixed.TotalCents != 27000 || mixed.Ref != "JANE 13OCT" {
		t.Errorf("issued and a draft: %+v", mixed)
	}

	// What is paid is no longer asked for.
	pay := func(s sessions.View) {
		in := map[string]any{"items": []map[string]any{{"kind": "session", "id": s.ID}}, "payment": map[string]any{"method": "cash"}}
		if err := a.Must("payments.set", in, nil); err != nil {
			t.Fatal(err)
		}
	}
	pay(ss[0])
	if half := ask(t, a, map[string]any{"ids": []string{inv.ID}}); half.TotalCents != 9000 {
		t.Errorf("half paid: %+v", half)
	}
	pay(ss[1])
	refusal(t, a, "documents.ask", map[string]any{"ids": []string{inv.ID}})
	if v := session(t, a, ss[1].ID); v.Can.AskToPay.OK {
		t.Error("a paid session's view offers asking to pay")
	}
	for _, d := range listed(t, a, jane) {
		if d.Can.AskToPay.OK != (d.ID == ss[2].Invoice.ID) {
			t.Errorf("%s %s: askToPay = %+v", d.Type, d.ID, d.Can.AskToPay)
		}
	}
}

func TestSendingForRecords(t *testing.T) {
	a, _, ss := setup(t)
	refusal(t, a, "documents.records", itemsOf(ss[0]))
	if session(t, a, ss[0].ID).Can.SendRecords.OK {
		t.Error("a session with nothing issued offers sending its documents")
	}
	if err := a.Must("documents.issue", map[string]any{"id": ss[0].Invoice.ID}, nil); err != nil {
		t.Fatal(err)
	}
	var docs []documents.Summary
	if err := a.Must("documents.records", itemsOf(ss[0]), &docs); err != nil {
		t.Fatal(err)
	}
	if len(docs) != 1 || docs[0].ID != ss[0].Invoice.ID || docs[0].ShareToken == "" {
		t.Errorf("records: %+v", docs)
	}
	if !session(t, a, ss[0].ID).Can.SendRecords.OK {
		t.Error("a session with an issued invoice doesn't offer sending it")
	}
}
