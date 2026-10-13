// Package memory is an in-memory stand-in for the repositories, for tests of
// the logic that spans several of them (billing, sync, documents).
package memory

import (
	"cmp"
	"context"
	"slices"
	"strings"
	"time"

	"bizzy-lambda/internal/features/attachments"
	"bizzy-lambda/internal/features/clients"
	"bizzy-lambda/internal/features/expenses"
	"bizzy-lambda/internal/features/followups"
	"bizzy-lambda/internal/features/packages"
	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/features/settings"
	"bizzy-lambda/internal/platform/dynamo"
)

type Store struct {
	ClientMap   map[string]clients.Client
	SessionMap  map[string]sessions.Session
	NotesMap    map[string]sessions.Notes
	FollowUpMap map[string]followups.FollowUp
	PackageMap  map[string]packages.Package
	SettingsVal settings.Settings
	// AttachmentMap is keyed "<ownerKind>#<ownerId>#<id>", as the SK.
	AttachmentMap map[string]attachments.Attachment
	ExpenseMap    map[string]expenses.Expense
	ItemMap       map[string]expenses.Item
	// CategoryList is nil until saved: the defaults.
	CategoryList []expenses.Category

	// Writes counts saves and deletes, to check that quiet runs write nothing.
	Writes int
}

func New() *Store {
	return &Store{
		ClientMap:   map[string]clients.Client{},
		SessionMap:  map[string]sessions.Session{},
		NotesMap:    map[string]sessions.Notes{},
		FollowUpMap: map[string]followups.FollowUp{},
		PackageMap:  map[string]packages.Package{},

		AttachmentMap: map[string]attachments.Attachment{},
		ExpenseMap:    map[string]expenses.Expense{},
		ItemMap:       map[string]expenses.Item{},
	}
}

// Clients, Sessions, FollowUps, Packages and Settings expose the store as
// each repository interface; the method sets overlap (Get, Save, …).
func (m *Store) Clients() *ClientRepo     { return (*ClientRepo)(m) }
func (m *Store) Sessions() *SessionRepo   { return (*SessionRepo)(m) }
func (m *Store) FollowUps() *FollowUpRepo { return (*FollowUpRepo)(m) }
func (m *Store) Packages() *PackageRepo   { return (*PackageRepo)(m) }
func (m *Store) Settings() *SettingsRepo  { return (*SettingsRepo)(m) }
func (m *Store) Payments() *PaymentRepo   { return (*PaymentRepo)(m) }
func (m *Store) Attachments() *AttachmentRepo {
	return (*AttachmentRepo)(m)
}
func (m *Store) Expenses() *ExpenseRepo { return (*ExpenseRepo)(m) }

type ClientRepo Store

func (r *ClientRepo) List(context.Context) ([]clients.Client, error) {
	all := make([]clients.Client, 0, len(r.ClientMap))
	for _, c := range r.ClientMap {
		all = append(all, c)
	}
	slices.SortFunc(all, func(a, b clients.Client) int { return strings.Compare(a.ID, b.ID) })
	return all, nil
}

func (r *ClientRepo) Get(_ context.Context, id string) (clients.Client, bool, error) {
	c, ok := r.ClientMap[id]
	return c, ok, nil
}

func (r *ClientRepo) SaveProfile(_ context.Context, c clients.Client) error {
	existing := r.ClientMap[c.ID]
	c.Activity, c.LastSessionAt, c.NextBookedAt, c.LastContactedAt = existing.Activity, existing.LastSessionAt, existing.NextBookedAt, existing.LastContactedAt
	r.ClientMap[c.ID] = c
	r.Writes++
	return nil
}

func (r *ClientRepo) SaveActivity(_ context.Context, c clients.Client) error {
	existing := r.ClientMap[c.ID]
	existing.Activity, existing.LastSessionAt, existing.NextBookedAt = c.Activity, c.LastSessionAt, c.NextBookedAt
	r.ClientMap[c.ID] = existing
	r.Writes++
	return nil
}

func (r *ClientRepo) RefreshContact(_ context.Context, id string, previous, next clients.Contact) (bool, error) {
	c, ok := r.ClientMap[id]
	if !ok || c.Contact == nil || c.Contact.ResourceName != previous.ResourceName || c.Contact.ETag != previous.ETag {
		return false, nil
	}
	c.Contact = &next
	r.ClientMap[id] = c
	r.Writes++
	return true, nil
}

// SetContacted writes only when she last contacted the client.
func (r *ClientRepo) SetContacted(_ context.Context, id string, at *time.Time) error {
	c, ok := r.ClientMap[id]
	if !ok {
		return nil
	}
	c.LastContactedAt = at
	r.ClientMap[id] = c
	r.Writes++
	return nil
}

type SessionRepo Store

func (r *SessionRepo) Get(_ context.Context, id string) (sessions.Session, bool, error) {
	s, ok := r.SessionMap[id]
	return s, ok, nil
}

func (r *SessionRepo) sorted(keep func(sessions.Session) bool) []sessions.Session {
	var out []sessions.Session
	for _, s := range r.SessionMap {
		if keep(s) {
			out = append(out, s)
		}
	}
	slices.SortFunc(out, func(a, b sessions.Session) int { return a.Start.Compare(b.Start) })
	return out
}

func (r *SessionRepo) ListByTime(_ context.Context, from, to time.Time) ([]sessions.Session, error) {
	return r.sorted(func(s sessions.Session) bool { return !s.Start.Before(from) && !s.Start.After(to) }), nil
}

func (r *SessionRepo) ListByClient(_ context.Context, id string) ([]sessions.Session, error) {
	return r.sorted(func(s sessions.Session) bool { return s.ClientID == id }), nil
}

func (r *SessionRepo) PageByClient(_ context.Context, id, _ string, _ int) (dynamo.Page[sessions.Session], error) {
	all := r.sorted(func(s sessions.Session) bool { return s.ClientID == id })
	slices.Reverse(all)
	return dynamo.Page[sessions.Session]{Items: all}, nil
}

func (r *SessionRepo) ListTodo(_ context.Context, until time.Time) ([]sessions.Session, error) {
	return r.sorted(func(s sessions.Session) bool { return s.Open() && !s.Start.After(until) }), nil
}

func (r *SessionRepo) ListByStatus(_ context.Context, status sessions.Status) ([]sessions.Session, error) {
	all := r.sorted(func(s sessions.Session) bool { return s.Status == status })
	slices.Reverse(all)
	return all, nil
}

func (r *SessionRepo) ListWithoutClient(context.Context) ([]sessions.Session, error) {
	return r.sorted(func(s sessions.Session) bool {
		return s.ClientID == "" && (s.Status == sessions.StatusParseError || s.Status == sessions.StatusUnmatched || s.Status == sessions.StatusTentative || s.Status == sessions.StatusRemoved)
	}), nil
}

// Save checks the version as the real repository does.
func (r *SessionRepo) Save(_ context.Context, s sessions.Session) (sessions.Session, error) {
	stored, exists := r.SessionMap[s.EventID]
	if exists != (s.Version > 0) || (exists && stored.Version != s.Version) {
		return sessions.Session{}, dynamo.ErrConflict
	}
	s.Version++
	r.SessionMap[s.EventID] = s
	r.Writes++
	return s, nil
}

func (r *SessionRepo) Delete(_ context.Context, s sessions.Session) error {
	stored, ok := r.SessionMap[s.EventID]
	if !ok || stored.Version != s.Version || stored.HasDocuments() {
		return dynamo.ErrConflict
	}
	delete(r.SessionMap, s.EventID)
	delete(r.NotesMap, s.EventID)
	r.Writes++
	return nil
}

func (r *SessionRepo) Notes(_ context.Context, id string) (sessions.Notes, error) {
	return r.NotesMap[id], nil
}

func (r *SessionRepo) SaveNotes(_ context.Context, n sessions.Notes) error {
	if n.Text == "" {
		delete(r.NotesMap, n.EventID)
	} else {
		r.NotesMap[n.EventID] = n
	}
	return nil
}

type FollowUpRepo Store

func (r *FollowUpRepo) Get(_ context.Context, id string) (followups.FollowUp, bool, error) {
	f, ok := r.FollowUpMap[id]
	return f, ok, nil
}

func (r *FollowUpRepo) sorted(keep func(followups.FollowUp) bool) []followups.FollowUp {
	var out []followups.FollowUp
	for _, f := range r.FollowUpMap {
		if keep(f) {
			out = append(out, f)
		}
	}
	slices.SortFunc(out, func(a, b followups.FollowUp) int { return a.Due.Compare(b.Due) })
	return out
}

func (r *FollowUpRepo) ListByTime(_ context.Context, from, to time.Time) ([]followups.FollowUp, error) {
	return r.sorted(func(f followups.FollowUp) bool { return !f.Due.Before(from) && !f.Due.After(to) }), nil
}

func (r *FollowUpRepo) ListOpen(_ context.Context, until time.Time) ([]followups.FollowUp, error) {
	return r.sorted(func(f followups.FollowUp) bool { return f.DoneAt == nil && !f.Due.After(until) }), nil
}

func (r *FollowUpRepo) ListWithoutClient(context.Context) ([]followups.FollowUp, error) {
	return r.sorted(func(f followups.FollowUp) bool { return f.ClientID == "" }), nil
}

func (r *FollowUpRepo) ListByClient(_ context.Context, id string) ([]followups.FollowUp, error) {
	return r.sorted(func(f followups.FollowUp) bool { return f.ClientID == id }), nil
}

func (r *FollowUpRepo) ListBySession(_ context.Context, id string) ([]followups.FollowUp, error) {
	return r.sorted(func(f followups.FollowUp) bool { return f.SessionID == id }), nil
}

// The pages hold everything: tests never ask for more than one.

func (r *FollowUpRepo) PageOpen(context.Context, string, int) (dynamo.Page[followups.FollowUp], error) {
	return dynamo.Page[followups.FollowUp]{Items: r.sorted(func(f followups.FollowUp) bool { return f.DoneAt == nil })}, nil
}

func (r *FollowUpRepo) PageDone(context.Context, string, int) (dynamo.Page[followups.FollowUp], error) {
	all := r.sorted(func(f followups.FollowUp) bool { return f.DoneAt != nil })
	slices.Reverse(all)
	return dynamo.Page[followups.FollowUp]{Items: all}, nil
}

func (r *FollowUpRepo) PageByClient(_ context.Context, id, _ string, _ int) (dynamo.Page[followups.FollowUp], error) {
	all := r.sorted(func(f followups.FollowUp) bool { return f.ClientID == id })
	slices.Reverse(all)
	return dynamo.Page[followups.FollowUp]{Items: all}, nil
}

// Save checks the version as the real repository does.
func (r *FollowUpRepo) Save(_ context.Context, f followups.FollowUp) (followups.FollowUp, error) {
	stored, exists := r.FollowUpMap[f.EventID]
	if exists != (f.Version > 0) || (exists && stored.Version != f.Version) {
		return followups.FollowUp{}, dynamo.ErrConflict
	}
	f.Version++
	r.FollowUpMap[f.EventID] = f
	r.Writes++
	return f, nil
}

func (r *FollowUpRepo) Delete(_ context.Context, id string) error {
	delete(r.FollowUpMap, id)
	r.Writes++
	return nil
}

type PackageRepo Store

func (r *PackageRepo) Get(_ context.Context, id string) (packages.Package, bool, error) {
	p, ok := r.PackageMap[id]
	return p, ok, nil
}

func (r *PackageRepo) List(context.Context) ([]packages.Package, error) {
	var out []packages.Package
	for _, p := range r.PackageMap {
		out = append(out, p)
	}
	return out, nil
}

func (r *PackageRepo) ListOpen(context.Context) ([]packages.Package, error) {
	var out []packages.Package
	for _, p := range r.PackageMap {
		if p.Open() {
			out = append(out, p)
		}
	}
	return out, nil
}

func (r *PackageRepo) ListByClient(_ context.Context, id string) ([]packages.Package, error) {
	var out []packages.Package
	for _, p := range r.PackageMap {
		if p.ClientID == id {
			out = append(out, p)
		}
	}
	return out, nil
}

// Save keeps the payment and document links, as the real repository does.
func (r *PackageRepo) Save(_ context.Context, p packages.Package) error {
	stored := r.PackageMap[p.ID]
	p.Payment, p.Invoice, p.Receipt = stored.Payment, stored.Invoice, stored.Receipt
	r.PackageMap[p.ID] = p
	r.Writes++
	return nil
}

// SetPayment writes only the payment, unless a receipt covers the package.
func (r *PackageRepo) SetPayment(_ context.Context, p packages.Package) error {
	stored, ok := r.PackageMap[p.ID]
	if !ok || stored.Receipt != nil {
		return dynamo.ErrConflict
	}
	stored.Payment = p.Payment
	r.PackageMap[p.ID] = stored
	r.Writes++
	return nil
}

func (r *PackageRepo) Delete(_ context.Context, id string) (bool, error) {
	if p, ok := r.PackageMap[id]; ok && p.HasDocuments() {
		return false, nil
	}
	delete(r.PackageMap, id)
	r.Writes++
	return true, nil
}

type SettingsRepo Store

func (r *SettingsRepo) Get(context.Context) (settings.Settings, error) {
	return r.SettingsVal.WithDefaults(), nil
}

func (r *SettingsRepo) Put(_ context.Context, s settings.Settings) error {
	r.SettingsVal = s
	return nil
}

// PaymentRepo is payments.Store: it commits all or none, as the real
// transaction does.
type PaymentRepo Store

func (r *PaymentRepo) GetSession(ctx context.Context, id string) (sessions.Session, bool, error) {
	return (*SessionRepo)(r).Get(ctx, id)
}

func (r *PaymentRepo) GetPackage(ctx context.Context, id string) (packages.Package, bool, error) {
	return (*PackageRepo)(r).Get(ctx, id)
}

func (r *PaymentRepo) Commit(_ context.Context, ss []sessions.Session, ps []packages.Package) error {
	for _, s := range ss {
		if stored, ok := r.SessionMap[s.EventID]; !ok || stored.Version != s.Version {
			return dynamo.ErrConflict
		}
	}
	for _, p := range ps {
		if stored, ok := r.PackageMap[p.ID]; !ok || stored.Receipt != nil {
			return dynamo.ErrConflict
		}
	}
	for _, s := range ss {
		s.Version++
		r.SessionMap[s.EventID] = s
		r.Writes++
	}
	for _, p := range ps {
		stored := r.PackageMap[p.ID]
		stored.Payment = p.Payment
		r.PackageMap[p.ID] = stored
		r.Writes++
	}
	return nil
}

type AttachmentRepo Store

func attachmentKey(kind attachments.OwnerKind, ownerID, id string) string {
	return string(kind) + "#" + ownerID + "#" + id
}

func (r *AttachmentRepo) List(_ context.Context, kind attachments.OwnerKind, ownerID string) ([]attachments.Attachment, error) {
	var out []attachments.Attachment
	for _, a := range r.AttachmentMap {
		if a.OwnerKind == kind && a.OwnerID == ownerID {
			out = append(out, a)
		}
	}
	attachments.SortOldestFirst(out)
	return out, nil
}

func (r *AttachmentRepo) Get(_ context.Context, kind attachments.OwnerKind, ownerID, id string) (attachments.Attachment, bool, error) {
	a, ok := r.AttachmentMap[attachmentKey(kind, ownerID, id)]
	return a, ok, nil
}

func (r *AttachmentRepo) Put(_ context.Context, a attachments.Attachment) error {
	r.AttachmentMap[attachmentKey(a.OwnerKind, a.OwnerID, a.ID)] = a
	r.Writes++
	return nil
}

func (r *AttachmentRepo) Delete(_ context.Context, a attachments.Attachment) error {
	delete(r.AttachmentMap, attachmentKey(a.OwnerKind, a.OwnerID, a.ID))
	r.Writes++
	return nil
}

type ExpenseRepo Store

func (r *ExpenseRepo) List(_ context.Context, from, to string) ([]expenses.Expense, error) {
	var out []expenses.Expense
	for _, e := range r.ExpenseMap {
		if e.Date >= from && e.Date <= to {
			out = append(out, e)
		}
	}
	slices.SortFunc(out, func(a, b expenses.Expense) int {
		return cmp.Or(strings.Compare(a.Date, b.Date), a.CreatedAt.Compare(b.CreatedAt))
	})
	return out, nil
}

func (r *ExpenseRepo) Get(_ context.Context, id string) (expenses.Expense, bool, error) {
	e, ok := r.ExpenseMap[id]
	return e, ok, nil
}

// Save checks the version as the real repository does.
func (r *ExpenseRepo) Save(_ context.Context, e expenses.Expense) (expenses.Expense, error) {
	stored, exists := r.ExpenseMap[e.ID]
	if exists != (e.Version > 0) || (exists && stored.Version != e.Version) {
		return expenses.Expense{}, dynamo.ErrConflict
	}
	e.Version++
	r.ExpenseMap[e.ID] = e
	r.Writes++
	return e, nil
}

func (r *ExpenseRepo) Delete(_ context.Context, e expenses.Expense) error {
	if stored, ok := r.ExpenseMap[e.ID]; !ok || stored.Version != e.Version {
		return dynamo.ErrConflict
	}
	delete(r.ExpenseMap, e.ID)
	r.Writes++
	return nil
}

func (r *ExpenseRepo) Items(context.Context) ([]expenses.Item, error) {
	out := make([]expenses.Item, 0, len(r.ItemMap))
	for _, it := range r.ItemMap {
		out = append(out, it)
	}
	expenses.SortItems(out)
	return out, nil
}

// SaveItem keeps the last amount, as the real repository's patch does.
func (r *ExpenseRepo) SaveItem(_ context.Context, it expenses.Item) error {
	it.LastAmountCents = r.ItemMap[it.ID].LastAmountCents
	r.ItemMap[it.ID] = it
	r.Writes++
	return nil
}

func (r *ExpenseRepo) SetLastAmount(_ context.Context, id string, cents int64) error {
	it := r.ItemMap[id]
	it.ID, it.LastAmountCents = id, &cents
	r.ItemMap[id] = it
	r.Writes++
	return nil
}

func (r *ExpenseRepo) Categories(context.Context) ([]expenses.Category, error) {
	if r.CategoryList == nil {
		return slices.Clone(expenses.DefaultCategories), nil
	}
	return slices.Clone(r.CategoryList), nil
}

func (r *ExpenseRepo) SaveCategories(_ context.Context, all []expenses.Category) error {
	r.CategoryList = slices.Clone(all)
	r.Writes++
	return nil
}
