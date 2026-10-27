package sessions_test

import (
	"slices"
	"testing"

	"bizzy-lambda/internal/features/documents"
	"bizzy-lambda/internal/features/packages"
	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/testutil/testapp"
)

// family is the app with Mum, who shares her packages with Adam and pays
// for him; Adam's usual fee is RM 80, and Lina's RM 70.
func family(t *testing.T) (a *testapp.App, mum, adam, lina string) {
	t.Helper()
	a = testapp.New()
	var err error
	if adam, err = a.Client("Adam Tan", map[string]any{"fee": map[string]any{"cents": 8000}}); err != nil {
		t.Fatal(err)
	}
	if lina, err = a.Client("Lina Tan", map[string]any{"fee": map[string]any{"cents": 7000}}); err != nil {
		t.Fatal(err)
	}
	if mum, err = a.Client("Mum Tan", map[string]any{"sharesWith": []string{adam}, "billingName": "Tan Holdings Sdn Bhd", "billingIdNo": "201901012345"}); err != nil {
		t.Fatal(err)
	}
	if err := a.Must("clients.update", map[string]any{"id": adam, "billTo": mum}, nil); err != nil {
		t.Fatal(err)
	}
	return a, mum, adam, lina
}

func buy(t *testing.T, a *testapp.App, in map[string]any) packages.View {
	t.Helper()
	var v packages.View
	if err := a.Must("packages.create", in, &v); err != nil {
		t.Fatal(err)
	}
	return v
}

func document(t *testing.T, a *testapp.App, id string) documents.View {
	t.Helper()
	var v documents.View
	if err := a.Must("documents.get", map[string]any{"id": id}, &v); err != nil {
		t.Fatal(err)
	}
	return v
}

func TestASharedPackagePaysForTheFamily(t *testing.T) {
	a, mum, adam, lina := family(t)
	pkg := buy(t, a, map[string]any{"clientId": mum, "hours": 2, "priceCents": 16000, "purchasedAt": at(0)})
	if !slices.Equal(pkg.SharedWith, []string{adam}) || pkg.Payer != mum {
		t.Fatalf("package shared with %v, paid by %s; want Adam's, by Mum", pkg.SharedWith, pkg.Payer)
	}

	// Its credits pay for Mum's session and Adam's, oldest first, one pool.
	own := create(t, a, book(mum, 2, 3, nil))
	adams := create(t, a, book(adam, 4, 5, nil))
	if len(own.Credits) != 1 || len(adams.Credits) != 1 || adams.Credits[0].PackageID != pkg.ID || adams.Invoice != nil {
		t.Fatalf("credits: Mum %+v, Adam %+v; want the package's, with no invoice", own.Credits, adams.Credits)
	}
	// Lina isn't in it: her usual fee pays, on her own invoice.
	linas := create(t, a, book(lina, 6, 7, nil))
	if len(linas.Credits) != 0 || linas.FeeCents != 7000 || linas.Payer != lina {
		t.Fatalf("Lina's session: %+v; want her usual fee, billed to her", linas)
	}

	// Used up: Adam's next session is his usual fee, billed to Mum, for him.
	more := create(t, a, book(adam, 8, 9, nil))
	if len(more.Credits) != 0 || more.FeeCents != 8000 || more.Payer != mum || more.Invoice == nil {
		t.Fatalf("Adam's next session: %+v; want his fee, billed to Mum", more)
	}
	inv := document(t, a, more.Invoice.ID)
	if inv.ClientID != mum || inv.Draft.Recipient.Name != "Tan Holdings Sdn Bhd" || inv.Draft.Recipient.RegNo != "201901012345" || inv.Draft.Recipient.IDNo != "" {
		t.Errorf("invoice to %s, recipient %+v; want Mum's company", inv.ClientID, inv.Draft.Recipient)
	}
	if l := inv.Draft.Lines[0]; l.For == nil || l.For.ClientID != adam || l.For.Name != "Adam Tan" {
		t.Errorf("line for %+v, want Adam", l.For)
	}
	if !slices.Equal(inv.For, []string{adam}) {
		t.Errorf("invoice summary for %v, want Adam", inv.For)
	}

	// Asking to pay for it asks Mum, naming Adam.
	var ask documents.Ask
	if err := a.Must("documents.ask", map[string]any{"items": []documents.Source{documents.SessionSource(more.ID)}}, &ask); err != nil {
		t.Fatal(err)
	}
	if ask.ClientID != mum || len(ask.Lines) != 1 || ask.Lines[0].For != "Adam Tan" || ask.Ref != "MUM 13OCT" {
		t.Errorf("ask = %+v; want Mum asked, for Adam", ask)
	}

	// Paid: received from Mum, still for Adam.
	if err := a.Must("payments.set", map[string]any{"items": []map[string]any{{"kind": "session", "id": more.ID}}, "payment": map[string]any{"method": "cash"}}, nil); err != nil {
		t.Fatal(err)
	}
	paid := view(t, a, more.ID)
	rcp := document(t, a, paid.Paid.ReceiptID)
	if rcp.ClientID != mum || rcp.Draft.Lines[0].For == nil || rcp.Draft.Lines[0].For.ClientID != adam {
		t.Errorf("receipt from %s, line for %+v; want from Mum, for Adam", rcp.ClientID, rcp.Draft.Lines[0].For)
	}

	// Adam's documents include those Mum pays for him.
	var adamsDocs []documents.Summary
	if err := a.Must("documents.listByClient", map[string]any{"clientId": adam}, &adamsDocs); err != nil {
		t.Fatal(err)
	}
	if len(adamsDocs) != 2 {
		t.Errorf("Adam's documents = %d, want Mum's invoice and receipt", len(adamsDocs))
	}

	// Adam uses the package, so it stays shared with him.
	refusal(t, a, "packages.update", map[string]any{"id": pkg.ID, "sharedWith": []string{lina}})
	if err := a.Must("packages.update", map[string]any{"id": pkg.ID, "sharedWith": []string{adam, lina}}, nil); err != nil {
		t.Fatal(err)
	}
}

func TestBillingASessionToAnotherClient(t *testing.T) {
	a, mum, _, lina := family(t)
	s := create(t, a, book(lina, 2, 3, nil))
	if s.Payer != lina {
		t.Fatalf("payer = %s, want Lina", s.Payer)
	}
	var moved sessions.View
	if err := a.Must("sessions.update", map[string]any{"id": s.ID, "billTo": mum}, &moved); err != nil {
		t.Fatal(err)
	}
	if moved.Payer != mum || moved.Invoice.ID == s.Invoice.ID {
		t.Fatalf("billed to %s on %s; want Mum, on a draft of hers", moved.Payer, moved.Invoice.ID)
	}

	// The document's payer is changed back on the document itself.
	var back documents.View
	if err := a.Must("documents.setPayer", map[string]any{"id": moved.Invoice.ID, "clientId": lina}, &back); err != nil {
		t.Fatal(err)
	}
	if back.ClientID != lina || back.Draft.Lines[0].For != nil || back.Draft.Recipient.Name != "Lina Tan" {
		t.Errorf("document to %s, line for %+v, recipient %q; want Lina's own", back.ClientID, back.Draft.Lines[0].For, back.Draft.Recipient.Name)
	}

	// Once issued, who pays stays.
	if err := a.Must("documents.issue", map[string]any{"id": back.ID}, nil); err != nil {
		t.Fatal(err)
	}
	refusal(t, a, "documents.setPayer", map[string]any{"id": back.ID, "clientId": mum})
	refusal(t, a, "sessions.update", map[string]any{"id": s.ID, "billTo": mum})
}

func view(t *testing.T, a *testapp.App, id string) sessions.View {
	t.Helper()
	var v sessions.View
	if err := a.Must("sessions.get", map[string]any{"id": id}, &v); err != nil {
		t.Fatal(err)
	}
	return v
}

func TestASessionPaidThereAndThen(t *testing.T) {
	a, jane, bob := setup(t)
	s := create(t, a, book(jane, 2, 3, map[string]any{
		"package": map[string]any{"bought": map[string]any{"hours": 5, "priceCents": 40000}},
		"payment": map[string]any{"method": "cash"},
	}))
	if s.OwedCents != 0 || s.Bought == nil || !s.Bought.Paid {
		t.Fatalf("owed %d, bought %+v; want it and its package paid", s.OwedCents, s.Bought)
	}
	// Her package's credits pay for the next: nothing to pay, so nothing is recorded.
	if next := create(t, a, book(jane, 4, 5, map[string]any{"payment": map[string]any{"method": "cash"}})); next.Paid != nil {
		t.Errorf("paid %+v for a session credits pay for", next.Paid)
	}
	// One not confirmed waits for its payment, so it isn't booked at all.
	refusal(t, a, "sessions.create", book(bob, 6, 7, map[string]any{"tentative": true, "fee": map[string]any{"cents": 5000}, "payment": map[string]any{"method": "cash"}}))
}
