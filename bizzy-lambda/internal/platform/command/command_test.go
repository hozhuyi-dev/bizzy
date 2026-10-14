package command

import (
	"context"
	"encoding/json"
	"slices"
	"strings"
	"testing"

	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/platform/statemodel"
	"bizzy-lambda/internal/router"
)

// A toy book: one bill, which an issued invoice and money received lock.
type bill struct {
	FeeCents int64
	Issued   bool
	Received bool
}

type setFee struct{ Cents int64 }
type deleteBill struct{}
type writeNote struct{}

func (setFee) Action() string     { return "bill.setFee" }
func (deleteBill) Action() string { return "bill.delete" }
func (writeNote) Action() string  { return "bill.note" }

var toyGuards = Guards[bill]{
	{
		ID: "issued-fixes-the-fee", On: On(setFee{}, deleteBill{}),
		Why:   "An issued invoice says what is owed",
		Fails: func(b bill, _ Command) bool { return b.Issued },
		Say: func(bill, Command) (string, []Remedy) {
			return "INV1 says RM 95.", []Remedy{{Action: "bill.cancel", Target: "INV1", Label: "Cancel INV1"}}
		},
		Remedies: []string{"bill.cancel"}, Seams: []string{"bill.creditNote"},
		Protects: []string{"issued-never-changes"},
	},
	{
		ID: "received-fixes-the-fee", On: On(setFee{}),
		Why:   "Money received settled the fee as it was",
		Fails: func(b bill, c Command) bool { return b.Received && c.(setFee).Cents != b.FeeCents },
		Say: func(bill, Command) (string, []Remedy) {
			return "RM 95 was received.", []Remedy{{Action: "bill.undoPayment", Label: "Undo the payment"}}
		},
		Remedies: []string{"bill.undoPayment"},
		Protects: []string{"received-matches-fee"},
	},
	{
		ID: "notes-later", On: On(writeNote{}),
		Why:      "Notes are written after the visit",
		Fails:    func(bill, Command) bool { return true },
		Say:      func(bill, Command) (string, []Remedy) { return "Not yet.", nil },
		NoRemedy: "it waits for the visit to start",
		Policy:   "notes are written once it has started",
	},
}

var toyInvariants = []string{"issued-never-changes", "received-matches-fee"}

func TestDecideRefusesWithEveryGuardInOrder(t *testing.T) {
	locked := bill{FeeCents: 9500, Issued: true, Received: true}
	got := toyGuards.Decide(locked, setFee{Cents: 12000})
	var ids []string
	for _, v := range got {
		ids = append(ids, v.Guard)
	}
	if !slices.Equal(ids, []string{"issued-fixes-the-fee", "received-fixes-the-fee"}) {
		t.Errorf("refused by %v, want both fee guards in table order", ids)
	}
	if got := toyGuards.Decide(locked, setFee{Cents: 9500}); len(got) != 1 {
		t.Errorf("the same fee: refused by %v, want only the issued invoice", got)
	}
	if got := toyGuards.Decide(bill{}, setFee{Cents: 12000}); got != nil {
		t.Errorf("an open bill refused: %v", got)
	}
	if got := toyGuards.Decide(locked, deleteBill{}); len(got) != 1 || got[0].Guard != "issued-fixes-the-fee" {
		t.Errorf("delete refused by %v, want the issued guard only (the other isn't on it)", got)
	}
	if v := toyGuards.Decide(bill{}, writeNote{}); len(v) != 1 || v[0].Remedies == nil {
		t.Errorf("a guard without remedies must still list none, not null: %+v", v)
	}
}

// A refusal reaches the app with its guard and remedies, through the
// router and through an entity's `can` verdict alike.
func TestRefusalCarriesRemedies(t *testing.T) {
	err := toyGuards.Check(bill{Issued: true}, setFee{Cents: 1})
	verdict := statemodel.Check(err)
	if verdict.OK || verdict.Guard != "issued-fixes-the-fee" || len(verdict.Remedies) != 1 || verdict.Remedies[0].Target != "INV1" {
		t.Errorf("verdict = %+v", verdict)
	}

	r := router.New()
	r.Mutation("bill.setFee", func(context.Context, json.RawMessage) (any, error) { return nil, err })
	res, _ := r.Handle(context.Background(), router.Request{Action: "bill.setFee"})
	body, _ := json.Marshal(res)
	want := `{"error":{"code":"conflict","message":"INV1 says RM 95.","guard":"issued-fixes-the-fee","remedies":[{"action":"bill.cancel","target":"INV1","label":"Cancel INV1"}]}}`
	if string(body) != want {
		t.Errorf("router answered %s\nwant %s", body, want)
	}

	if Err(nil) != nil || toyGuards.Check(bill{}, setFee{}) != nil {
		t.Error("nothing refused must be no error")
	}
	plain, _ := json.Marshal(router.Response{Error: &router.ErrorBody{Code: apperr.CodeInvalid, Message: "x"}})
	if strings.Contains(string(plain), "guard") || strings.Contains(string(plain), "remedies") {
		t.Errorf("an error no guard raised carries no guard or remedies: %s", plain)
	}
}

func TestOfferedHoldsRefusalsToTheirRow(t *testing.T) {
	for _, v := range toyGuards.Decide(bill{Issued: true, Received: true}, setFee{Cents: 1}) {
		if err := toyGuards.Offered(v); err != nil {
			t.Error(err)
		}
	}
	if err := toyGuards.Offered(Violation{Guard: "issued-fixes-the-fee", Remedies: []Remedy{{Action: "bill.delete"}}}); err == nil {
		t.Error("a remedy the row doesn't declare must be reported")
	}
	if err := toyGuards.Offered(Violation{Guard: "received-fixes-the-fee", Remedies: []Remedy{}}); err == nil {
		t.Error("a refusal without remedies, from a row that has some, must be reported")
	}
	if err := toyGuards.Offered(toyGuards.Decide(bill{}, writeNote{})[0]); err != nil {
		t.Errorf("a row saying why it has no remedy may refuse without one: %v", err)
	}
}

func TestLint(t *testing.T) {
	if errs := toyGuards.Lint(toyInvariants); len(errs) > 0 {
		t.Errorf("toy guards: %v", errs)
	}
	fails := func(bill, Command) bool { return false }
	say := func(bill, Command) (string, []Remedy) { return "", nil }
	bad := Guards[bill]{
		{ID: "a", On: On(setFee{}, setFee{}), Why: "w", Fails: fails, Say: say, Remedies: []string{"x"}, Protects: []string{"nope"}},
		{ID: "a", On: nil, Fails: fails, Say: say, Policy: "p"},
		{ID: "b", On: On(deleteBill{}), Why: "w", Remedies: []string{"x"}, NoRemedy: "n", Protects: []string{"issued-never-changes"}, Policy: "p"},
	}
	var got []string
	for _, err := range bad.Lint(toyInvariants) {
		got = append(got, err.Error())
	}
	for _, want := range []string{
		"a lists an action twice", "a protects nope, which is no invariant",
		"a appears twice", "a guards no action", "a doesn't say why", "a offers no remedy",
		"b needs Fails and Say", "b has remedies and NoRemedy", "b needs exactly one of Protects",
	} {
		if !slices.ContainsFunc(got, func(s string) bool { return strings.HasPrefix(s, want) }) {
			t.Errorf("lint missed %q; got %v", want, got)
		}
	}
	if got := toyGuards.Unguarded(append(toyInvariants, "kept-by-hand")); !slices.Equal(got, []string{"kept-by-hand"}) {
		t.Errorf("unguarded = %v", got)
	}
}

func TestGuards(t *testing.T) {
	CheckTable(t, "testdata/guards.md", "Toy", toyGuards, toyInvariants)
}
