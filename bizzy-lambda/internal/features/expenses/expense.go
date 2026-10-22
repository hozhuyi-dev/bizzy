// Package expenses is what the practice spends: one expense per receipt,
// with where it was bought, the day, and a line per item on it. Each line
// names an item from a list that grows as the user types new ones, and
// every item belongs to a category. The categories follow the business
// expenses on LHDN's Form B, so a year's totals per category are what the
// tax return asks for; the user can rename, add and archive them. The
// receipt itself is attached as a file (attachments.OwnerExpense).
package expenses

import (
	"strings"
	"time"

	"bizzy-lambda/internal/platform/txn"
)

// Expense is one receipt.
type Expense struct {
	ID string `json:"id"`
	// Date is the day on the receipt, YYYY-MM-DD.
	Date string `json:"date"`
	// Vendor is where it was bought: "Shopee", a shop's name.
	Vendor    string    `json:"vendor,omitempty"`
	Lines     []Line    `json:"lines"`
	Notes     string    `json:"notes,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// Expenses are filed by date.
var Expenses = txn.Kind[Expense]{
	Name: "EXPENSE", Gone: "This expense was deleted.",
	Doc: txn.Doc{What: "A receipt of what the practice spent, a line per item.", Time: "its date"},
	Meta: func(e *Expense) txn.Meta {
		day, _ := time.Parse(time.DateOnly, e.Date)
		return txn.Meta{ID: e.ID, Time: day}
	},
}

// Line is one item on a receipt.
type Line struct {
	ItemID string `json:"itemId"`
	// Name and CategoryID are the item's as the line was written:
	// renaming the item or moving it later leaves what was spent on what,
	// in a year whose taxes are filed, as it was.
	Name        string `json:"name"`
	CategoryID  string `json:"categoryId"`
	AmountCents int64  `json:"amountCents"`
}

// TotalCents is what the receipt comes to.
func (e Expense) TotalCents() int64 {
	var total int64
	for _, l := range e.Lines {
		total += l.AmountCents
	}
	return total
}

// Spending is what the expenses dated in a span add up to.
type Spending struct {
	// ByMonth is by month, "2026-10".
	ByMonth map[string]int64
	// ByCategory is by category id.
	ByCategory map[string]int64
}

// SpentBetween sums the expenses dated from one day to another, both
// included.
func SpentBetween(tx *txn.Tx, from, to time.Time) (Spending, error) {
	out := Spending{ByMonth: map[string]int64{}, ByCategory: map[string]int64{}}
	all, err := Expenses.Between(tx, from, to)
	for _, e := range all {
		for _, l := range e.Lines {
			out.ByMonth[e.Date[:7]] += l.AmountCents
			out.ByCategory[l.CategoryID] += l.AmountCents
		}
	}
	return out, err
}

// Item is one thing the business buys, from the list lines are picked
// from.
type Item struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	CategoryID string `json:"categoryId"`
	// Archived hides it from the list; lines keep it.
	Archived bool `json:"archived,omitempty"`
	// LastAmountCents is what it cost last time, to prefill a new line.
	LastAmountCents *int64 `json:"lastAmountCents,omitempty"`
}

var Items = txn.Kind[Item]{
	Name: "EXPENSEITEM", Gone: "This item is no longer in the list.",
	Doc:   txn.Doc{What: "An item expense lines are picked from, in a category."},
	Meta:  func(it *Item) txn.Meta { return txn.Meta{ID: it.ID} },
	Whole: true,
}

// Vendor is somewhere the business buys from, from the list the form
// suggests. A receipt names it as text, as it was typed: archiving one
// hides it from the suggestions and leaves the receipts as they were.
type Vendor struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	// LastUsed is the latest receipt's day, YYYY-MM-DD: the most recent
	// are suggested first.
	LastUsed string `json:"lastUsed"`
	Archived bool   `json:"archived,omitempty"`
}

var Vendors = txn.Kind[Vendor]{
	Name: "EXPENSEVENDOR", Gone: "This shop is no longer in the list.",
	Doc:   txn.Doc{What: "A shop or website receipts are from, suggested on the next one."},
	Meta:  func(v *Vendor) txn.Meta { return txn.Meta{ID: v.ID} },
	Whole: true,
}

// Category groups items the way the tax return does.
type Category struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	// Hint says what goes in it.
	Hint string `json:"hint,omitempty"`
	// Capital is equipment that lasts: claimed through capital allowances
	// rather than as an expense of the year.
	Capital bool `json:"capital,omitempty"`
	// Archived hides it for new items; what is in it stays.
	Archived bool `json:"archived,omitempty"`
}

// CategoryList is every category, in the order the user keeps them: one
// item.
type CategoryList struct {
	Categories []Category `json:"categories"`
}

const categoriesID = "ALL"

var Categories = txn.Kind[CategoryList]{
	Name: "EXPENSECATEGORIES", Gone: "No categories are set.",
	Doc:   txn.Doc{What: "Every expense category, in order: one item, ALL."},
	Meta:  func(*CategoryList) txn.Meta { return txn.Meta{ID: categoriesID} },
	Whole: true,
}

// DefaultCategories are the expenses on Form B's profit and loss account,
// plus equipment (capital allowances) and what isn't deductible. Their ids
// never change, whatever they are renamed to.
var DefaultCategories = []Category{
	{ID: "purchases", Name: "Purchases and cost of production", Hint: "Supplies used in treatment: tape, gel, needles, consumables"},
	{ID: "rental", Name: "Rental / lease", Hint: "Clinic or room rent, equipment on lease"},
	{ID: "salaries", Name: "Salaries and wages", Hint: "Staff pay, EPF and SOCSO contributions"},
	{ID: "contracts", Name: "Contracts and subcontracts", Hint: "Locum or freelance therapists"},
	{ID: "commissions", Name: "Commissions", Hint: "Referral fees, platform commissions"},
	{ID: "travel", Name: "Travelling and transportation", Hint: "Fuel, tolls, parking and rides for home visits"},
	{ID: "repairs", Name: "Repairs and maintenance", Hint: "Servicing equipment, fixing the clinic"},
	{ID: "promotion", Name: "Promotion and advertisement", Hint: "Ads, flyers, website, business cards"},
	{ID: "loan-interest", Name: "Loan interest", Hint: "Interest on business loans and hire purchase"},
	{ID: "other", Name: "Other expenses", Hint: "Phone, internet, software, bank fees, insurance, courses, professional fees"},
	{ID: "equipment", Name: "Equipment and other assets", Hint: "Treatment bed, machines, laptop: claimed as capital allowances", Capital: true},
	{ID: "non-allowable", Name: "Non-allowable expenses", Hint: "Personal spending, fines: recorded, not deductible"},
}

// CategoriesOf is every category: the user's, or the defaults until
// they change them.
func CategoriesOf(tx *txn.Tx) ([]Category, error) {
	c, ok, err := Categories.Find(tx, categoriesID)
	if err != nil || !ok {
		return DefaultCategories, err
	}
	return c.Categories, nil
}

func hasCategory(all []Category, id string) bool {
	for _, c := range all {
		if c.ID == id {
			return true
		}
	}
	return false
}

// normalizeName compares item names however they were typed.
func normalizeName(name string) string {
	return strings.ToLower(strings.Join(strings.Fields(name), " "))
}

// cleanText trims a typed value and collapses its spaces.
func cleanText(s string) string {
	return strings.Join(strings.Fields(s), " ")
}
