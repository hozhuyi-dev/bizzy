// Package memory is an in-memory stand-in for the repositories, for tests of
// the logic that spans several of them (billing, sync, documents).
package memory

import (
	"context"
	"slices"
	"strings"
	"time"

	"bizzy-lambda/internal/features/clients"
	"bizzy-lambda/internal/features/packages"
	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/features/settings"
)

type Store struct {
	ClientMap   map[string]clients.Client
	SessionMap  map[string]sessions.Session
	PackageMap  map[string]packages.Package
	SettingsVal settings.Settings

	// Writes counts saves and deletes, to check that quiet runs write nothing.
	Writes int
}

func New() *Store {
	return &Store{
		ClientMap:  map[string]clients.Client{},
		SessionMap: map[string]sessions.Session{},
		PackageMap: map[string]packages.Package{},
	}
}

// Clients, Sessions, Packages and Settings expose the store as each
// repository interface; the method sets overlap (Get, Save, …).
func (m *Store) Clients() *ClientRepo   { return (*ClientRepo)(m) }
func (m *Store) Sessions() *SessionRepo { return (*SessionRepo)(m) }
func (m *Store) Packages() *PackageRepo { return (*PackageRepo)(m) }
func (m *Store) Settings() *SettingsRepo {
	return (*SettingsRepo)(m)
}

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
	existing.Activity, existing.LastSessionAt = c.Activity, c.LastSessionAt
	r.ClientMap[c.ID] = existing
	r.Writes++
	return nil
}

func (r *ClientRepo) SetNextBooked(_ context.Context, id string, at *time.Time) error {
	c := r.ClientMap[id]
	c.NextBookedAt = at
	r.ClientMap[id] = c
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

func (r *SessionRepo) ListOpen(context.Context) ([]sessions.Session, error) {
	return r.sorted(sessions.Session.Open), nil
}

// Save keeps her fields (ignored, document), as the real repository does.
func (r *SessionRepo) Save(_ context.Context, s sessions.Session) error {
	if existing, ok := r.SessionMap[s.EventID]; ok {
		s.Ignored, s.Document = existing.Ignored, existing.Document
	} else {
		s.Ignored, s.Document = false, nil
	}
	r.SessionMap[s.EventID] = s
	r.Writes++
	return nil
}

func (r *SessionRepo) Delete(_ context.Context, id string) (bool, error) {
	if s, ok := r.SessionMap[id]; ok && s.Document != nil {
		return false, nil
	}
	delete(r.SessionMap, id)
	r.Writes++
	return true, nil
}

func (r *SessionRepo) SetIgnored(_ context.Context, id string, ignored bool) (bool, error) {
	s, ok := r.SessionMap[id]
	if !ok {
		return false, nil
	}
	s.Ignored = ignored
	r.SessionMap[id] = s
	return true, nil
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

func (r *PackageRepo) Save(_ context.Context, p packages.Package) error {
	p.Document = r.PackageMap[p.ID].Document
	r.PackageMap[p.ID] = p
	r.Writes++
	return nil
}

func (r *PackageRepo) Delete(_ context.Context, id string) (bool, error) {
	if p, ok := r.PackageMap[id]; ok && p.Document != nil {
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
