package expenses_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"bizzy-lambda/internal/features/expenses"
	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/testutil/memory"
)

func newService() (expenses.Service, *memory.Store, *[]string) {
	m := memory.New()
	var deleted []string
	return expenses.Service{
		Repo: m.Expenses(),
		AfterDelete: func(_ context.Context, id string) error {
			deleted = append(deleted, id)
			return nil
		},
		Now: func() time.Time { return time.Date(2026, 10, 13, 9, 0, 0, 0, time.UTC) },
	}, m, &deleted
}

func code(err error) apperr.Code {
	var appErr *apperr.Error
	if errors.As(err, &appErr) {
		return appErr.Code
	}
	return ""
}

// A receipt's new lines add their items to the list once, however she
// typed the name, and each item remembers what it last cost.
func TestSaveAddsItemsOnce(t *testing.T) {
	ctx := context.Background()
	s, m, _ := newService()

	first, err := s.Save(ctx, expenses.SaveInput{Date: "2026-10-12", Vendor: " Shopee ", Lines: []expenses.Line{
		{Name: "Kinesio tape", CategoryID: "purchases", AmountCents: 4500},
		{Name: "kinesio  TAPE", CategoryID: "purchases", AmountCents: 4000},
		{Name: "Parking", CategoryID: "travel", AmountCents: 300},
	}})
	if err != nil {
		t.Fatalf("Save: %v", err)
	}
	if first.TotalCents != 8800 || first.Vendor != "Shopee" || len(m.ItemMap) != 2 {
		t.Errorf("total %d, vendor %q, %d items; want 8800, Shopee, 2", first.TotalCents, first.Vendor, len(m.ItemMap))
	}
	tape := m.ItemMap[first.Lines[0].ItemID]
	if first.Lines[1].ItemID != tape.ID || *tape.LastAmountCents != 4000 {
		t.Errorf("tape = %+v, want both lines on it, last at 4000", tape)
	}

	// Moving the item to another category leaves the line as it was.
	if _, err := s.SaveItem(ctx, expenses.Item{ID: tape.ID, Name: "Kinesio tape", CategoryID: "other"}); err != nil {
		t.Fatalf("SaveItem: %v", err)
	}
	if got := m.ExpenseMap[first.ID].Lines[0].CategoryID; got != "purchases" {
		t.Errorf("line category = %q, want it kept as purchases", got)
	}
	if got := *m.ItemMap[tape.ID].LastAmountCents; got != 4000 {
		t.Errorf("editing the item lost its last amount: %d", got)
	}
}

func TestSaveRefusals(t *testing.T) {
	ctx := context.Background()
	s, _, _ := newService()
	line := expenses.Line{Name: "Gel", CategoryID: "purchases", AmountCents: 1000}

	for name, in := range map[string]expenses.SaveInput{
		"no day":           {Lines: []expenses.Line{line}},
		"no lines":         {Date: "2026-10-12"},
		"comes to nothing": {Date: "2026-10-12", Lines: []expenses.Line{{Name: "Gel", CategoryID: "purchases"}}},
		"no category":      {Date: "2026-10-12", Lines: []expenses.Line{{Name: "Gel", AmountCents: 1}}},
		"unnamed line":     {Date: "2026-10-12", Lines: []expenses.Line{{CategoryID: "purchases", AmountCents: 1}}},
	} {
		if _, err := s.Save(ctx, in); code(err) != apperr.CodeInvalid {
			t.Errorf("%s: error = %v, want invalid", name, err)
		}
	}

	saved, _ := s.Save(ctx, expenses.SaveInput{Date: "2026-10-12", Lines: []expenses.Line{line}})
	if _, err := s.Save(ctx, expenses.SaveInput{ID: saved.ID, Version: saved.Version - 1, Date: "2026-10-12", Lines: []expenses.Line{line}}); err != expenses.ErrChanged {
		t.Errorf("saving a stale version: %v, want ErrChanged", err)
	}
}

func TestDeleteRemovesTheFiles(t *testing.T) {
	ctx := context.Background()
	s, m, deleted := newService()
	saved, _ := s.Save(ctx, expenses.SaveInput{Date: "2026-10-12", Lines: []expenses.Line{{Name: "Gel", CategoryID: "purchases", AmountCents: 1000}}})

	if err := s.Delete(ctx, saved.ID, saved.Version); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if _, ok := m.ExpenseMap[saved.ID]; ok || len(*deleted) != 1 || (*deleted)[0] != saved.ID {
		t.Errorf("expense still stored (%v) or its files not deleted (%v)", ok, *deleted)
	}
}

// Categories follow Form B until she changes them; one is archived, never
// deleted, since lines are filed under it.
func TestCategories(t *testing.T) {
	ctx := context.Background()
	s, _, _ := newService()
	cat, _ := s.Catalogue(ctx)
	if len(cat.Categories) != len(expenses.DefaultCategories) || cat.Categories[0].ID != "purchases" {
		t.Fatalf("categories = %v, want the Form B defaults", cat.Categories)
	}

	edited := append(cat.Categories, expenses.Category{Name: "Courses"})
	edited[0].Name = "Supplies"
	edited[1].Archived = true
	saved, err := s.SaveCategories(ctx, edited)
	if err != nil {
		t.Fatalf("SaveCategories: %v", err)
	}
	if saved[0].ID != "purchases" || saved[0].Name != "Supplies" || saved[len(saved)-1].ID == "" {
		t.Errorf("saved = %v, want the rename kept on its id and the new one given an id", saved)
	}

	if _, err := s.SaveCategories(ctx, saved[1:]); code(err) != apperr.CodeInvalid {
		t.Errorf("dropping a category: %v, want it refused", err)
	}
}
