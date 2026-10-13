package expenses

import (
	"context"
	"errors"
	"slices"
	"time"
	"unicode/utf8"

	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/platform/dynamo"
)

// Store is what the service reads and writes.
type Store interface {
	List(ctx context.Context, from, to string) ([]Expense, error)
	Get(ctx context.Context, id string) (Expense, bool, error)
	Save(ctx context.Context, e Expense) (Expense, error)
	Delete(ctx context.Context, e Expense) error
	Items(ctx context.Context) ([]Item, error)
	SaveItem(ctx context.Context, it Item) error
	SetLastAmount(ctx context.Context, id string, cents int64) error
	Categories(ctx context.Context) ([]Category, error)
	SaveCategories(ctx context.Context, all []Category) error
}

// Service is the expenses' use cases: an expense with the items its lines
// add and the files it keeps elsewhere, the catalogue they are picked from.
type Service struct {
	Repo Store
	// AfterDelete removes what a deleted expense keeps elsewhere: its files.
	AfterDelete func(ctx context.Context, id string) error
	Now         func() time.Time
}

// Limits on what she types, well inside DynamoDB's 400 KB per item.
const (
	maxVendor = 100
	maxNotes  = 2000
	maxName   = 100
	maxHint   = 200
	maxLines  = 50
)

// List returns the expenses dated in [from, to] (YYYY-MM-DD), oldest first.
func (s Service) List(ctx context.Context, from, to string) ([]View, error) {
	fromDay, errFrom := time.Parse(time.DateOnly, from)
	toDay, errTo := time.Parse(time.DateOnly, to)
	switch {
	case errFrom != nil || errTo != nil || toDay.Before(fromDay):
		return nil, apperr.Invalid("from and to are days, from first")
	case toDay.Sub(fromDay) > 400*24*time.Hour:
		return nil, apperr.Invalid("ask for at most a year at a time")
	}
	all, err := s.Repo.List(ctx, from, to)
	if err != nil {
		return nil, err
	}
	return Views(all), nil
}

func (s Service) Get(ctx context.Context, id string) (View, error) {
	e, found, err := s.Repo.Get(ctx, id)
	if err != nil {
		return View{}, err
	}
	if !found {
		return View{}, ErrGone
	}
	return e.View(), nil
}

// Catalogue is the categories and items lines are picked from.
func (s Service) Catalogue(ctx context.Context) (Catalogue, error) {
	categories, err := s.Repo.Categories(ctx)
	if err != nil {
		return Catalogue{}, err
	}
	items, err := s.Repo.Items(ctx)
	return Catalogue{Categories: categories, Items: items}, err
}

// SaveInput is an expense as the form has it. A line without an item id
// names a new item, which is added to the list (or matched to one already
// there by name). Version is the one she edited: 0 for a new expense.
type SaveInput struct {
	ID      string `json:"id"`
	Version int    `json:"version"`
	Date    string `json:"date"`
	Vendor  string `json:"vendor"`
	Notes   string `json:"notes"`
	Lines   []Line `json:"lines"`
}

// Save creates or replaces an expense, adding to the list the items its
// lines name that aren't there yet.
func (s Service) Save(ctx context.Context, in SaveInput) (View, error) {
	if _, err := time.Parse(time.DateOnly, in.Date); err != nil {
		return View{}, apperr.Invalid("choose the day on the receipt")
	}
	vendor := cleanText(in.Vendor)
	switch {
	case utf8.RuneCountInString(vendor) > maxVendor:
		return View{}, apperr.Invalid("keep where it was bought to %d characters", maxVendor)
	case len(in.Notes) > maxNotes:
		return View{}, apperr.Invalid("the notes are too long to save")
	case len(in.Lines) == 0:
		return View{}, apperr.Invalid("add what was bought")
	case len(in.Lines) > maxLines:
		return View{}, apperr.Invalid("one receipt takes at most %d lines", maxLines)
	}

	cat, err := s.Catalogue(ctx)
	if err != nil {
		return View{}, err
	}
	lines, created, err := resolveLines(in.Lines, cat)
	if err != nil {
		return View{}, err
	}

	now := s.Now().UTC()
	e := Expense{ID: in.ID, Date: in.Date, Vendor: vendor, Notes: in.Notes, Lines: lines, CreatedAt: now, UpdatedAt: now}
	if e.TotalCents() <= 0 {
		return View{}, apperr.Invalid("the receipt comes to nothing; enter what each line cost")
	}
	if in.ID == "" {
		e.ID = dynamo.NewID()
	} else {
		stored, err := s.stored(ctx, in.ID, in.Version)
		if err != nil {
			return View{}, err
		}
		e.CreatedAt, e.Files, e.Version = stored.CreatedAt, stored.Files, stored.Version
	}

	for _, it := range created {
		if err := s.Repo.SaveItem(ctx, it); err != nil {
			return View{}, err
		}
	}
	saved, err := s.Repo.Save(ctx, e)
	if errors.Is(err, dynamo.ErrConflict) {
		return View{}, ErrChanged
	}
	if err != nil {
		return View{}, err
	}
	for _, l := range saved.Lines {
		if err := s.Repo.SetLastAmount(ctx, l.ItemID, l.AmountCents); err != nil {
			return View{}, err
		}
	}
	return saved.View(), nil
}

// Delete removes an expense and its files.
func (s Service) Delete(ctx context.Context, id string, version int) error {
	stored, err := s.stored(ctx, id, version)
	if err != nil {
		return err
	}
	if err := s.Repo.Delete(ctx, stored); errors.Is(err, dynamo.ErrConflict) {
		return ErrChanged
	} else if err != nil {
		return err
	}
	if s.AfterDelete != nil {
		return s.AfterDelete(ctx, stored.ID)
	}
	return nil
}

// stored reads an expense she is changing, as of the version she saw.
func (s Service) stored(ctx context.Context, id string, version int) (Expense, error) {
	e, found, err := s.Repo.Get(ctx, id)
	if err != nil {
		return Expense{}, err
	}
	if !found {
		return Expense{}, ErrGone
	}
	return e, e.CanChange(version)
}

// resolveLines checks each line and gives a line naming a new item that
// item: one already in the list by that name, or a new one, returned to be
// created.
func resolveLines(in []Line, cat Catalogue) ([]Line, []Item, error) {
	byID := map[string]Item{}
	byName := map[string]Item{}
	for _, it := range cat.Items {
		byID[it.ID] = it
		byName[normalizeName(it.Name)] = it
	}

	var created []Item
	out := make([]Line, len(in))
	for i, l := range in {
		l.Name = cleanText(l.Name)
		switch {
		case l.Name == "":
			return nil, nil, apperr.Invalid("line %d needs what was bought", i+1)
		case utf8.RuneCountInString(l.Name) > maxName:
			return nil, nil, apperr.Invalid("keep %q to %d characters", l.Name, maxName)
		case !cat.hasCategory(l.CategoryID):
			return nil, nil, apperr.Invalid("choose a category for %s", l.Name)
		case l.AmountCents < 0:
			return nil, nil, apperr.Invalid("%s can't cost less than nothing", l.Name)
		}
		if l.ItemID != "" {
			if _, ok := byID[l.ItemID]; !ok {
				return nil, nil, apperr.NotFound("%s is no longer in the list of items", l.Name)
			}
		} else if it, ok := byName[normalizeName(l.Name)]; ok {
			l.ItemID = it.ID
		} else {
			it := Item{ID: dynamo.NewID(), Name: l.Name, CategoryID: l.CategoryID}
			byID[it.ID], byName[normalizeName(it.Name)] = it, it
			created = append(created, it)
			l.ItemID = it.ID
		}
		out[i] = l
	}
	return out, created, nil
}

// SaveItem renames an item, moves it to another category (for lines from
// now on) or archives it.
func (s Service) SaveItem(ctx context.Context, in Item) (Item, error) {
	cat, err := s.Catalogue(ctx)
	if err != nil {
		return Item{}, err
	}
	i := slices.IndexFunc(cat.Items, func(it Item) bool { return it.ID == in.ID })
	if i < 0 {
		return Item{}, apperr.NotFound("This item is no longer in the list.")
	}
	it := cat.Items[i]
	it.Name, it.CategoryID, it.Archived = cleanText(in.Name), in.CategoryID, in.Archived
	switch {
	case it.Name == "":
		return Item{}, apperr.Invalid("the item needs a name")
	case utf8.RuneCountInString(it.Name) > maxName:
		return Item{}, apperr.Invalid("keep the name to %d characters", maxName)
	case !cat.hasCategory(it.CategoryID):
		return Item{}, apperr.Invalid("choose a category for %s", it.Name)
	}
	for _, other := range cat.Items {
		if other.ID != it.ID && normalizeName(other.Name) == normalizeName(it.Name) {
			return Item{}, apperr.Conflict("%s is already in the list", other.Name)
		}
	}
	if err := s.Repo.SaveItem(ctx, it); err != nil {
		return Item{}, err
	}
	return it, nil
}

// SaveCategories replaces the categories, in the order given: renamed,
// added (without an id) or archived. One is never deleted, since lines and
// items are filed under it; archiving hides it for new items.
func (s Service) SaveCategories(ctx context.Context, in []Category) ([]Category, error) {
	current, err := s.Repo.Categories(ctx)
	if err != nil {
		return nil, err
	}
	seen := map[string]bool{}
	names := map[string]bool{}
	out := make([]Category, 0, len(in))
	for _, c := range in {
		c.Name, c.Hint = cleanText(c.Name), cleanText(c.Hint)
		switch {
		case c.Name == "":
			return nil, apperr.Invalid("every category needs a name")
		case utf8.RuneCountInString(c.Name) > maxName || utf8.RuneCountInString(c.Hint) > maxHint:
			return nil, apperr.Invalid("keep %s shorter", c.Name)
		case names[normalizeName(c.Name)]:
			return nil, apperr.Invalid("two categories are called %s", c.Name)
		case c.ID == "":
			c.ID = dynamo.NewID()
		case !slices.ContainsFunc(current, func(old Category) bool { return old.ID == c.ID }):
			return nil, apperr.NotFound("%s is no longer a category", c.Name)
		case seen[c.ID]:
			return nil, apperr.Invalid("%s is listed twice", c.Name)
		}
		seen[c.ID], names[normalizeName(c.Name)] = true, true
		out = append(out, c)
	}
	for _, old := range current {
		if !seen[old.ID] {
			return nil, apperr.Invalid("%s can't be deleted, as items are filed under it; archive it instead", old.Name)
		}
	}
	if err := s.Repo.SaveCategories(ctx, out); err != nil {
		return nil, err
	}
	return out, nil
}
