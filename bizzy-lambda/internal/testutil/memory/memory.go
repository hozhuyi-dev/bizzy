// Package memory is an in-memory stand-in for the repositories, for tests of
// the logic that spans several of them (the book, the sync).
package memory

import (
	"cmp"
	"context"
	"maps"
	"slices"
	"strings"
	"time"

	"bizzy-lambda/internal/features/attachments"
	"bizzy-lambda/internal/features/clients"
	"bizzy-lambda/internal/features/conflicts"
	"bizzy-lambda/internal/features/documents"
	"bizzy-lambda/internal/features/expenses"
	"bizzy-lambda/internal/features/followups"
	"bizzy-lambda/internal/features/packages"
	"bizzy-lambda/internal/features/recovery"
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
	JournalMap   map[string]recovery.Entry

	Docs      map[string]documents.Document
	Revs      []documents.Revision
	Counters  map[string]int64
	SharesMap map[string]string
	// ConflictMap and ExternalMap are keyed as conflicts.Key.
	ConflictMap map[string]conflicts.Conflict
	ExternalMap map[string]conflicts.External

	// Writes counts saves and deletes, to check that quiet runs write nothing.
	Writes int
	// onWrite runs before each write; a test can panic in it to stop the
	// process there, as a Lambda timeout would.
	onWrite func(op string)
}

// OnWrite sets what runs before each write, op naming it.
func (m *Store) OnWrite(f func(op string)) { m.onWrite = f }

// BeforeWrite runs the OnWrite hook; the repositories over the store (here
// and in memdocs) call it before they change anything.
func (m *Store) BeforeWrite(op string) {
	if m.onWrite != nil {
		m.onWrite(op)
	}
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
		JournalMap:    map[string]recovery.Entry{},

		Docs:        map[string]documents.Document{},
		Counters:    map[string]int64{},
		SharesMap:   map[string]string{},
		ConflictMap: map[string]conflicts.Conflict{},
		ExternalMap: map[string]conflicts.External{},
	}
}

// Journal exposes the store as recovery.Store.
func (m *Store) Journal() *JournalRepo { return (*JournalRepo)(m) }

type JournalRepo Store

func (r *JournalRepo) Put(_ context.Context, e recovery.Entry) error {
	(*Store)(r).BeforeWrite("journal.put")
	r.JournalMap[e.ID] = e
	return nil
}

func (r *JournalRepo) Delete(_ context.Context, id string) error {
	(*Store)(r).BeforeWrite("journal.delete")
	delete(r.JournalMap, id)
	return nil
}

func (r *JournalRepo) List(context.Context) ([]recovery.Entry, error) {
	out := make([]recovery.Entry, 0, len(r.JournalMap))
	for _, e := range r.JournalMap {
		out = append(out, e)
	}
	slices.SortFunc(out, func(a, b recovery.Entry) int { return strings.Compare(a.ID, b.ID) })
	return out, nil
}

// Clients, Sessions, FollowUps, Packages and Settings expose the store as
// each repository interface; the method sets overlap (Get, Save, …).
func (m *Store) Clients() *ClientRepo     { return (*ClientRepo)(m) }
func (m *Store) Sessions() *SessionRepo   { return (*SessionRepo)(m) }
func (m *Store) FollowUps() *FollowUpRepo { return (*FollowUpRepo)(m) }
func (m *Store) Packages() *PackageRepo   { return (*PackageRepo)(m) }
func (m *Store) Settings() *SettingsRepo  { return (*SettingsRepo)(m) }
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
	(*Store)(r).BeforeWrite("clients.saveProfile")
	existing := r.ClientMap[c.ID]
	c.Activity, c.LastSessionAt, c.NextBookedAt, c.LastContactedAt = existing.Activity, existing.LastSessionAt, existing.NextBookedAt, existing.LastContactedAt
	r.ClientMap[c.ID] = c
	r.Writes++
	return nil
}

func (r *ClientRepo) SaveActivity(_ context.Context, c clients.Client) error {
	(*Store)(r).BeforeWrite("clients.saveActivity")
	existing := r.ClientMap[c.ID]
	existing.Activity, existing.LastSessionAt, existing.NextBookedAt = c.Activity, c.LastSessionAt, c.NextBookedAt
	r.ClientMap[c.ID] = existing
	r.Writes++
	return nil
}

func (r *ClientRepo) RefreshContact(_ context.Context, id string, previous, next clients.Contact) (bool, error) {
	(*Store)(r).BeforeWrite("clients.refreshContact")
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
	(*Store)(r).BeforeWrite("clients.setContacted")
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
	slices.SortFunc(out, func(a, b sessions.Session) int { return cmp.Or(a.Start.Compare(b.Start), strings.Compare(a.ID, b.ID)) })
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

func (r *SessionRepo) ListPending(context.Context) ([]sessions.Session, error) {
	return r.sorted(func(s sessions.Session) bool { return s.Event.Pending }), nil
}

// Save checks the version as the real repository does.
func (r *SessionRepo) Save(_ context.Context, s sessions.Session) (sessions.Session, error) {
	(*Store)(r).BeforeWrite("sessions.save")
	stored, exists := r.SessionMap[s.ID]
	if exists != (s.Version > 0) || (exists && stored.Version != s.Version) {
		return sessions.Session{}, dynamo.ErrConflict
	}
	s.Version++
	r.SessionMap[s.ID] = s
	r.Writes++
	return s, nil
}

func (r *SessionRepo) Notes(_ context.Context, id string) (sessions.Notes, error) {
	return r.NotesMap[id], nil
}

func (r *SessionRepo) SaveNotes(_ context.Context, n sessions.Notes) error {
	(*Store)(r).BeforeWrite("sessions.saveNotes")
	if n.Text == "" {
		delete(r.NotesMap, n.SessionID)
	} else {
		r.NotesMap[n.SessionID] = n
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
	slices.SortFunc(out, func(a, b followups.FollowUp) int { return cmp.Or(a.Due.Compare(b.Due), cmp.Compare(a.ID, b.ID)) })
	return out
}

func (r *FollowUpRepo) ListByTime(_ context.Context, from, to time.Time) ([]followups.FollowUp, error) {
	return r.sorted(func(f followups.FollowUp) bool { return !f.Due.Before(from) && !f.Due.After(to) }), nil
}

func (r *FollowUpRepo) ListOpen(_ context.Context, until time.Time) ([]followups.FollowUp, error) {
	return r.sorted(func(f followups.FollowUp) bool { return f.DoneAt == nil && !f.Due.After(until) }), nil
}

func (r *FollowUpRepo) ListPending(context.Context) ([]followups.FollowUp, error) {
	return r.sorted(func(f followups.FollowUp) bool { return f.Event.Pending }), nil
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
	(*Store)(r).BeforeWrite("followUps.save")
	stored, exists := r.FollowUpMap[f.ID]
	if exists != (f.Version > 0) || (exists && stored.Version != f.Version) {
		return followups.FollowUp{}, dynamo.ErrConflict
	}
	f.Version++
	r.FollowUpMap[f.ID] = f
	r.Writes++
	return f, nil
}

type PackageRepo Store

func (r *PackageRepo) Get(_ context.Context, id string) (packages.Package, bool, error) {
	p, ok := r.PackageMap[id]
	return p, ok, nil
}

func (r *PackageRepo) sorted(keep func(packages.Package) bool) []packages.Package {
	var out []packages.Package
	for _, p := range r.PackageMap {
		if keep(p) {
			out = append(out, p)
		}
	}
	slices.SortFunc(out, func(a, b packages.Package) int {
		return cmp.Or(a.PurchasedAt.Compare(b.PurchasedAt), strings.Compare(a.ID, b.ID))
	})
	return out
}

func (r *PackageRepo) List(context.Context) ([]packages.Package, error) {
	all := r.sorted(func(packages.Package) bool { return true })
	slices.Reverse(all)
	return all, nil
}

func (r *PackageRepo) ListOpen(context.Context) ([]packages.Package, error) {
	return r.sorted(packages.Package.Open), nil
}

func (r *PackageRepo) ListByClient(_ context.Context, id string) ([]packages.Package, error) {
	return r.sorted(func(p packages.Package) bool { return p.ClientID == id }), nil
}

type SettingsRepo Store

func (r *SettingsRepo) Get(context.Context) (settings.Settings, error) {
	return r.SettingsVal.WithDefaults(), nil
}

func (r *SettingsRepo) Put(_ context.Context, s settings.Settings) error {
	(*Store)(r).BeforeWrite("settings.put")
	r.SettingsVal = s
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

func (r *AttachmentRepo) ListAll(context.Context) ([]attachments.Attachment, error) {
	keys := slices.Sorted(maps.Keys(r.AttachmentMap))
	out := make([]attachments.Attachment, len(keys))
	for i, k := range keys {
		out[i] = r.AttachmentMap[k]
	}
	return out, nil
}

func (r *AttachmentRepo) Get(_ context.Context, kind attachments.OwnerKind, ownerID, id string) (attachments.Attachment, bool, error) {
	a, ok := r.AttachmentMap[attachmentKey(kind, ownerID, id)]
	return a, ok, nil
}

func (r *AttachmentRepo) Put(_ context.Context, a attachments.Attachment) error {
	(*Store)(r).BeforeWrite("attachments.put")
	r.AttachmentMap[attachmentKey(a.OwnerKind, a.OwnerID, a.ID)] = a
	r.Writes++
	return nil
}

func (r *AttachmentRepo) Delete(_ context.Context, a attachments.Attachment) error {
	(*Store)(r).BeforeWrite("attachments.delete")
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
	(*Store)(r).BeforeWrite("expenses.save")
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
	(*Store)(r).BeforeWrite("expenses.delete")
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
	(*Store)(r).BeforeWrite("expenses.saveItem")
	it.LastAmountCents = r.ItemMap[it.ID].LastAmountCents
	r.ItemMap[it.ID] = it
	r.Writes++
	return nil
}

func (r *ExpenseRepo) SetLastAmount(_ context.Context, id string, cents int64) error {
	(*Store)(r).BeforeWrite("expenses.setLastAmount")
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
	(*Store)(r).BeforeWrite("expenses.saveCategories")
	r.CategoryList = slices.Clone(all)
	r.Writes++
	return nil
}
