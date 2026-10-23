package expenses

import (
	"slices"
	"time"
	"unicode/utf8"

	"bizzy-lambda/internal/features/attachments"
	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/platform/txn"
)

// Limits on what the user types, well inside DynamoDB's 400 KB per item.
const (
	maxVendor = 100
	maxNotes  = 2000
	maxName   = 100
	maxHint   = 200
	maxLines  = 50
)

// Receipt is an expense as the form has it. A line without an item id
// names a new item, which is added to the list (or matched to one already
// there by name).
type Receipt struct {
	Date   string `json:"date"`
	Vendor string `json:"vendor"`
	Notes  string `json:"notes"`
	Lines  []Line `json:"lines"`
}

// Create records an expense.
func Create(tx *txn.Tx, in Receipt) (*Expense, error) {
	e := &Expense{ID: tx.NewID(), CreatedAt: tx.Now().UTC()}
	if err := fill(tx, e, in); err != nil {
		return nil, err
	}
	return e, Expenses.Add(tx, e)
}

// Update replaces what an expense says.
func Update(tx *txn.Tx, id string, in Receipt) (*Expense, error) {
	e, err := Expenses.Get(tx, id)
	if err != nil {
		return nil, err
	}
	return e, fill(tx, e, in)
}

// Delete removes an expense and its files, returning their keys for the
// caller to delete once this commits.
func Delete(tx *txn.Tx, id string) ([]string, error) {
	if _, err := Expenses.Get(tx, id); err != nil {
		return nil, err
	}
	if err := Expenses.Delete(tx, id); err != nil {
		return nil, err
	}
	return attachments.RemoveAll(tx, attachments.OwnerExpense, id)
}

// CanAttach is the refusal for attaching files to an expense
// (attachments.Owner): it must exist.
func CanAttach(tx *txn.Tx, id string) error {
	_, err := Expenses.Get(tx, id)
	return err
}

// fill makes an expense say what the receipt does, adding to the list the
// items its lines name that aren't there yet.
func fill(tx *txn.Tx, e *Expense, in Receipt) error {
	if _, err := time.Parse(time.DateOnly, in.Date); err != nil {
		return apperr.Invalid("Choose the day on the receipt.")
	}
	vendor := cleanText(in.Vendor)
	switch {
	case utf8.RuneCountInString(vendor) > maxVendor:
		return apperr.Invalid("Keep where it was bought to %d characters.", maxVendor)
	case len(in.Notes) > maxNotes:
		return apperr.Invalid("The notes are too long to save.")
	case len(in.Lines) == 0:
		return apperr.Invalid("Add what was bought.")
	case len(in.Lines) > maxLines:
		return apperr.Invalid("One receipt takes at most %d lines.", maxLines)
	}
	lines, err := resolveLines(tx, in.Lines)
	if err != nil {
		return err
	}
	e.Date, e.Vendor, e.Notes, e.Lines, e.UpdatedAt = in.Date, vendor, in.Notes, lines, tx.Now().UTC()
	if e.TotalCents() <= 0 {
		return apperr.Invalid("The receipt comes to nothing; enter what each line cost.")
	}
	if err := useVendor(tx, vendor, in.Date); err != nil {
		return err
	}
	for _, l := range lines {
		it, err := Items.Get(tx, l.ItemID)
		if err != nil {
			return err
		}
		cents := l.AmountCents
		it.LastAmountCents = &cents
	}
	return nil
}

// resolveLines checks each line, and gives a line naming a new item that
// item: one already in the list by that name, or a new one.
func resolveLines(tx *txn.Tx, in []Line) ([]Line, error) {
	cats, err := CategoriesOf(tx)
	if err != nil {
		return nil, err
	}
	items, err := Items.All(tx)
	if err != nil {
		return nil, err
	}
	byName := map[string]*Item{}
	for _, it := range items {
		byName[normalizeName(it.Name)] = it
	}
	out := make([]Line, len(in))
	for i, l := range in {
		l.Name = cleanText(l.Name)
		switch {
		case l.Name == "":
			return nil, apperr.Invalid("Line %d needs what was bought.", i+1)
		case utf8.RuneCountInString(l.Name) > maxName:
			return nil, apperr.Invalid("Keep %q to %d characters.", l.Name, maxName)
		case !hasCategory(cats, l.CategoryID):
			return nil, apperr.Invalid("Choose a category for %s.", l.Name)
		case l.AmountCents < 0:
			return nil, apperr.Invalid("%s can't cost less than nothing.", l.Name)
		}
		if l.ItemID != "" {
			if _, err := Items.Get(tx, l.ItemID); err != nil {
				return nil, err
			}
		} else if it, ok := byName[normalizeName(l.Name)]; ok {
			l.ItemID = it.ID
		} else {
			it := &Item{ID: tx.NewID(), Name: l.Name, CategoryID: l.CategoryID}
			if err := Items.Add(tx, it); err != nil {
				return nil, err
			}
			byName[normalizeName(it.Name)] = it
			l.ItemID = it.ID
		}
		out[i] = l
	}
	return out, nil
}

// useVendor adds where a receipt is from to the list, or, when it is
// there by name, moves its last use on to the receipt's day.
func useVendor(tx *txn.Tx, name, day string) error {
	if name == "" {
		return nil
	}
	all, err := Vendors.All(tx)
	if err != nil {
		return err
	}
	for _, v := range all {
		if normalizeName(v.Name) == normalizeName(name) {
			if day > v.LastUsed {
				v.LastUsed = day
			}
			return nil
		}
	}
	return Vendors.Add(tx, &Vendor{ID: tx.NewID(), Name: name, LastUsed: day})
}

// ArchiveVendor hides a vendor from the suggestions, or brings it back.
// Receipts name it as text, so they stay as they were.
func ArchiveVendor(tx *txn.Tx, id string, archived bool) (*Vendor, error) {
	v, err := Vendors.Get(tx, id)
	if err != nil {
		return nil, err
	}
	v.Archived = archived
	return v, nil
}

// SaveItem renames an item, moves it to another category (for lines from
// now on), or archives it.
func SaveItem(tx *txn.Tx, in Item) (*Item, error) {
	it, err := Items.Get(tx, in.ID)
	if err != nil {
		return nil, err
	}
	cats, err := CategoriesOf(tx)
	if err != nil {
		return nil, err
	}
	name := cleanText(in.Name)
	switch {
	case name == "":
		return nil, apperr.Invalid("The item needs a name.")
	case utf8.RuneCountInString(name) > maxName:
		return nil, apperr.Invalid("Keep the name to %d characters.", maxName)
	case !hasCategory(cats, in.CategoryID):
		return nil, apperr.Invalid("Choose a category for %s.", name)
	}
	others, err := Items.All(tx)
	if err != nil {
		return nil, err
	}
	for _, other := range others {
		if other.ID != it.ID && normalizeName(other.Name) == normalizeName(name) {
			return nil, apperr.Refused(other.Name + " is already in the list.")
		}
	}
	it.Name, it.CategoryID, it.Archived = name, in.CategoryID, in.Archived
	return it, nil
}

// SaveCategories replaces the categories, in the order given: renamed,
// added (without an id) or archived. One is never deleted, since lines
// and items are filed under it: archiving hides it for new items.
func SaveCategories(tx *txn.Tx, in []Category) ([]Category, error) {
	current, err := CategoriesOf(tx)
	if err != nil {
		return nil, err
	}
	seen, names := map[string]bool{}, map[string]bool{}
	out := make([]Category, 0, len(in))
	for _, c := range in {
		c.Name, c.Hint = cleanText(c.Name), cleanText(c.Hint)
		switch {
		case c.Name == "":
			return nil, apperr.Invalid("Every category needs a name.")
		case utf8.RuneCountInString(c.Name) > maxName || utf8.RuneCountInString(c.Hint) > maxHint:
			return nil, apperr.Invalid("Keep %s shorter.", c.Name)
		case names[normalizeName(c.Name)]:
			return nil, apperr.Invalid("Two categories are called %s.", c.Name)
		case c.ID == "":
			c.ID = tx.NewID()
		case !hasCategory(current, c.ID):
			return nil, apperr.NotFound("%s is no longer a category.", c.Name)
		case seen[c.ID]:
			return nil, apperr.Invalid("%s is listed twice.", c.Name)
		}
		seen[c.ID], names[normalizeName(c.Name)] = true, true
		out = append(out, c)
	}
	for _, old := range current {
		if !seen[old.ID] {
			return nil, apperr.Refused(old.Name + " can't be deleted, as items are filed under it; archive it instead.")
		}
	}
	list, ok, err := Categories.Find(tx, categoriesID)
	switch {
	case err != nil:
		return nil, err
	case ok:
		list.Categories = slices.Clone(out)
	default:
		err = Categories.Add(tx, &CategoryList{Categories: slices.Clone(out)})
	}
	return out, err
}
