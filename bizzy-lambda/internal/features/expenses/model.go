// Package expenses records what the practice spends: one expense per
// receipt, with where it was bought, the day, and a line per item on it.
// Each line names an item from a list that grows as she types new ones,
// and every item belongs to a category. The categories follow the business
// expenses on LHDN's Form B, so a year's totals per category are what the
// tax return asks for; she can rename, add and archive them should the form
// change. Receipts are attached as files (attachments.OwnerExpense).
package expenses

import (
	"slices"
	"strings"
	"time"
)

// Expense is one receipt. It is written whole with a version check.
type Expense struct {
	ID string `json:"id" dynamodbav:"id"`
	// Date is the day on the receipt, YYYY-MM-DD.
	Date string `json:"date" dynamodbav:"date"`
	// Vendor is where she bought it: "Shopee", a shop's name.
	Vendor string `json:"vendor,omitempty" dynamodbav:"vendor,omitempty"`
	Lines  []Line `json:"lines" dynamodbav:"lines"`
	Notes  string `json:"notes,omitempty" dynamodbav:"notes,omitempty"`
	// Files is how many files are attached: the receipt's photo or PDF.
	Files     int       `json:"files,omitempty" dynamodbav:"files,omitempty"`
	CreatedAt time.Time `json:"createdAt" dynamodbav:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt" dynamodbav:"updatedAt"`
	Version   int       `json:"version" dynamodbav:"version"`
}

// Line is one item on a receipt.
type Line struct {
	ItemID string `json:"itemId" dynamodbav:"itemId"`
	// Name and CategoryID are the item's as the line was written: renaming
	// the item or moving it to another category later leaves what was spent
	// on what, in a year whose taxes are filed, as it was.
	Name        string `json:"name" dynamodbav:"name"`
	CategoryID  string `json:"categoryId" dynamodbav:"categoryId"`
	AmountCents int64  `json:"amountCents" dynamodbav:"amountCents"`
}

// TotalCents is what the receipt comes to.
func (e Expense) TotalCents() int64 {
	var total int64
	for _, l := range e.Lines {
		total += l.AmountCents
	}
	return total
}

// Item is one thing she buys, from the list she picks lines from.
type Item struct {
	ID         string `json:"id" dynamodbav:"id"`
	Name       string `json:"name" dynamodbav:"name"`
	CategoryID string `json:"categoryId" dynamodbav:"categoryId"`
	// Archived hides it from the list she picks from; lines keep it.
	Archived bool `json:"archived,omitempty" dynamodbav:"archived,omitempty"`
	// LastAmountCents is what it cost the last time, to prefill a new line.
	LastAmountCents *int64 `json:"lastAmountCents,omitempty" dynamodbav:"lastAmountCents,omitempty"`
}

// Category groups items the way the tax return does.
type Category struct {
	ID   string `json:"id" dynamodbav:"id"`
	Name string `json:"name" dynamodbav:"name"`
	// Hint says what goes in it.
	Hint string `json:"hint,omitempty" dynamodbav:"hint,omitempty"`
	// Capital is equipment that lasts: claimed through capital allowances
	// rather than as an expense of the year.
	Capital bool `json:"capital,omitempty" dynamodbav:"capital,omitempty"`
	// Archived hides it for new items; what is in it stays.
	Archived bool `json:"archived,omitempty" dynamodbav:"archived,omitempty"`
}

// DefaultCategories are the expenses on Form B's profit and loss account,
// plus equipment (capital allowances) and what isn't deductible, as she
// starts with them. Their ids never change, whatever she renames them to.
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

// Catalogue is what lines are picked from.
type Catalogue struct {
	Categories []Category `json:"categories"`
	Items      []Item     `json:"items"`
}

// hasCategory reports whether a category exists, archived or not.
func (c Catalogue) hasCategory(id string) bool {
	return slices.ContainsFunc(c.Categories, func(cat Category) bool { return cat.ID == id })
}

// normalizeName compares item names however she typed them.
func normalizeName(name string) string {
	return strings.ToLower(strings.Join(strings.Fields(name), " "))
}

// cleanText trims a typed value and collapses its spaces.
func cleanText(s string) string {
	return strings.Join(strings.Fields(s), " ")
}
