package memory

import (
	"context"
	"errors"
	"fmt"
	"maps"
	"slices"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"

	"bizzy-lambda/internal/features/book"
	"bizzy-lambda/internal/features/conflicts"
	"bizzy-lambda/internal/features/documents"
	"bizzy-lambda/internal/features/sessions"
	"bizzy-lambda/internal/platform/dynamo"
)

// Documents, Conflicts and Book expose the store as those repositories.
func (m *Store) Documents() *DocumentRepo { return (*DocumentRepo)(m) }
func (m *Store) Conflicts() *ConflictRepo { return (*ConflictRepo)(m) }
func (m *Store) Book() *BookRepo          { return (*BookRepo)(m) }

type DocumentRepo Store

func (r *DocumentRepo) Get(_ context.Context, id string) (documents.Document, bool, error) {
	d, ok := r.Docs[id]
	return d, ok, nil
}

func (r *DocumentRepo) sorted(keep func(documents.Document) bool) []documents.Document {
	var out []documents.Document
	for _, d := range r.Docs {
		if keep(d) {
			out = append(out, d)
		}
	}
	// Newest first, as the indexes return them.
	slices.SortFunc(out, func(a, b documents.Document) int {
		return strings.Compare(b.Date+"#"+b.CreatedAt.String()+b.ID, a.Date+"#"+a.CreatedAt.String()+a.ID)
	})
	return out
}

func (r *DocumentRepo) ListByMonth(_ context.Context, docType documents.Type, month string) ([]documents.Document, error) {
	return r.sorted(func(d documents.Document) bool { return d.Type == docType && strings.HasPrefix(d.Date, month+"-") }), nil
}

func (r *DocumentRepo) ListByClient(_ context.Context, clientID string) ([]documents.Document, error) {
	return r.sorted(func(d documents.Document) bool { return d.ClientID == clientID }), nil
}

func (r *DocumentRepo) SharedID(_ context.Context, token string) (string, bool, error) {
	id, ok := r.SharesMap[token]
	return id, ok, nil
}

func (r *DocumentRepo) Revisions(_ context.Context, id string) ([]documents.Revision, error) {
	var out []documents.Revision
	for _, rev := range r.Revs {
		if rev.DocumentID == id {
			out = append(out, rev)
		}
	}
	return out, nil
}

func (r *DocumentRepo) Counter(_ context.Context, key string) (int64, error) {
	return r.Counters[key], nil
}

func (r *DocumentRepo) SetShare(_ context.Context, d documents.Document, change documents.ShareChange) error {
	(*Store)(r).BeforeWrite("documents.setShare")
	if stored, ok := r.Docs[d.ID]; !ok || stored.Version != d.Version {
		return dynamo.ErrTransactionConflict
	}
	if _, taken := r.SharesMap[change.New]; taken {
		return dynamo.ErrTransactionConflict
	}
	d.Version++
	r.Docs[d.ID] = d
	r.SharesMap[change.New] = d.ID
	if change.Old != "" {
		delete(r.SharesMap, change.Old)
	}
	r.Writes++
	return nil
}

type ConflictRepo Store

func (r *ConflictRepo) Get(_ context.Context, key string) (conflicts.Conflict, bool, error) {
	c, ok := r.ConflictMap[key]
	return c, ok, nil
}

func (r *ConflictRepo) sorted(keep func(conflicts.Conflict) bool) []conflicts.Conflict {
	var out []conflicts.Conflict
	for _, c := range r.ConflictMap {
		if keep(c) {
			out = append(out, c)
		}
	}
	slices.SortFunc(out, func(a, b conflicts.Conflict) int {
		if c := a.At.Compare(b.At); c != 0 {
			return c
		}
		return strings.Compare(a.Key, b.Key)
	})
	return out
}

func (r *ConflictRepo) ListOpen(context.Context) ([]conflicts.Conflict, error) {
	return r.sorted(func(conflicts.Conflict) bool { return true }), nil
}

func (r *ConflictRepo) ListByTarget(_ context.Context, targetID string) ([]conflicts.Conflict, error) {
	return r.sorted(func(c conflicts.Conflict) bool { return c.TargetID == targetID }), nil
}

// Save checks the version as the real repository does.
func (r *ConflictRepo) Save(_ context.Context, c conflicts.Conflict) (conflicts.Conflict, error) {
	(*Store)(r).BeforeWrite("conflicts.save")
	stored, exists := r.ConflictMap[c.Key]
	if exists != (c.Version > 0) || (exists && stored.Version != c.Version) {
		return conflicts.Conflict{}, dynamo.ErrConflict
	}
	c.Version++
	r.ConflictMap[c.Key] = c
	r.Writes++
	return c, nil
}

func (r *ConflictRepo) Delete(_ context.Context, key string) error {
	if _, ok := r.ConflictMap[key]; !ok {
		return nil
	}
	(*Store)(r).BeforeWrite("conflicts.delete")
	delete(r.ConflictMap, key)
	r.Writes++
	return nil
}

func (r *ConflictRepo) External(_ context.Context, surface conflicts.Surface, externalID string) (conflicts.External, bool, error) {
	e, ok := r.ExternalMap[conflicts.Key(surface, externalID)]
	return e, ok, nil
}

func (r *ConflictRepo) PutExternal(_ context.Context, e conflicts.External) error {
	(*Store)(r).BeforeWrite("externals.put")
	r.ExternalMap[e.Key()] = e
	r.Writes++
	return nil
}

func (r *ConflictRepo) DeleteExternal(_ context.Context, surface conflicts.Surface, externalID string) error {
	key := conflicts.Key(surface, externalID)
	if _, ok := r.ExternalMap[key]; !ok {
		return nil
	}
	(*Store)(r).BeforeWrite("externals.delete")
	delete(r.ExternalMap, key)
	r.Writes++
	return nil
}

// BookRepo is book.Store: it commits all or none, as the real transaction
// does, and refuses a change that writes one item twice, as DynamoDB does.
type BookRepo Store

func (r *BookRepo) Load(_ context.Context, clientIDs []string, numbering []string) (book.Loaded, error) {
	l := book.Loaded{Settings: r.SettingsVal.WithDefaults(), ClientIDs: clientIDs, Counters: map[string]int64{}}
	for _, id := range slices.Sorted(maps.Keys(r.ClientMap)) {
		l.Clients = append(l.Clients, r.ClientMap[id])
	}
	for _, id := range clientIDs {
		for _, sid := range slices.Sorted(maps.Keys(r.SessionMap)) {
			if s := r.SessionMap[sid]; s.ClientID == id {
				l.Sessions = append(l.Sessions, s)
			}
		}
		for _, pid := range slices.Sorted(maps.Keys(r.PackageMap)) {
			if p := r.PackageMap[pid]; p.ClientID == id {
				l.Packages = append(l.Packages, p)
			}
		}
		for _, did := range slices.Sorted(maps.Keys(r.Docs)) {
			if d := r.Docs[did]; d.ClientID == id {
				l.Docs = append(l.Docs, d)
			}
		}
		for _, fid := range slices.Sorted(maps.Keys(r.FollowUpMap)) {
			if f := r.FollowUpMap[fid]; f.ClientID == id {
				l.FollowUps = append(l.FollowUps, f)
			}
		}
	}
	for _, key := range numbering {
		l.Counters[key] = r.Counters[key]
	}
	return l, nil
}

func (r *BookRepo) Owner(_ context.Context, kind, id string) (string, bool, error) {
	switch kind {
	case "session":
		s, ok := r.SessionMap[id]
		return s.ClientID, ok, nil
	case "package":
		p, ok := r.PackageMap[id]
		return p.ClientID, ok, nil
	case "followUp":
		f, ok := r.FollowUpMap[id]
		return f.ClientID, ok, nil
	default:
		d, ok := r.Docs[id]
		return d.ClientID, ok, nil
	}
}

func (r *BookRepo) Booked(_ context.Context, from, to time.Time) ([]sessions.Session, error) {
	var out []sessions.Session
	for _, id := range slices.Sorted(maps.Keys(r.SessionMap)) {
		if s := r.SessionMap[id]; !s.Start.Before(from) && s.Start.Before(to) {
			out = append(out, s)
		}
	}
	return out, nil
}

func (r *BookRepo) Counter(_ context.Context, key string) (int64, error) {
	return r.Counters[key], nil
}

func (r *BookRepo) Commit(_ context.Context, c book.Change) error {
	(*Store)(r).BeforeWrite("book.commit")
	if err := oneWriteEach(c); err != nil {
		return err
	}
	for _, s := range c.Sessions {
		if stored, ok := r.SessionMap[s.ID]; ok != (s.Version > 0) || (ok && stored.Version != s.Version) {
			return dynamo.ErrConflict
		}
	}
	for _, s := range c.SessionsGone {
		if stored, ok := r.SessionMap[s.ID]; !ok || stored.Version != s.Version {
			return dynamo.ErrConflict
		}
	}
	for _, p := range c.Packages {
		if stored, ok := r.PackageMap[p.ID]; ok != (p.Version > 0) || (ok && stored.Version != p.Version) {
			return dynamo.ErrConflict
		}
	}
	for _, p := range c.PackagesGone {
		if stored, ok := r.PackageMap[p.ID]; !ok || stored.Version != p.Version {
			return dynamo.ErrConflict
		}
	}
	for _, d := range c.Docs {
		if stored, ok := r.Docs[d.ID]; ok != (d.Version > 0) || (ok && stored.Version != d.Version) {
			return dynamo.ErrConflict
		}
	}
	for _, d := range c.DocsGone {
		if stored, ok := r.Docs[d.ID]; !ok || stored.Version != d.Version {
			return dynamo.ErrConflict
		}
	}
	for _, f := range c.FollowUps {
		if stored, ok := r.FollowUpMap[f.ID]; ok != (f.Version > 0) || (ok && stored.Version != f.Version) {
			return dynamo.ErrConflict
		}
	}
	for _, f := range c.FollowUpsGone {
		if stored, ok := r.FollowUpMap[f.ID]; !ok || stored.Version != f.Version {
			return dynamo.ErrConflict
		}
	}
	for _, rev := range c.Revisions {
		if slices.ContainsFunc(r.Revs, func(x documents.Revision) bool { return x.DocumentID == rev.DocumentID && x.Revision == rev.Revision }) {
			return dynamo.ErrConflict
		}
	}
	for _, bump := range c.Counters {
		if r.Counters[bump.Key] != bump.Prev {
			return dynamo.ErrConflict
		}
	}
	for _, s := range c.Shares {
		if _, taken := r.SharesMap[s.Change.New]; taken {
			return dynamo.ErrConflict
		}
	}
	for _, e := range c.Externals {
		if stored, ok := r.ExternalMap[e.Key()]; ok && stored.ID != e.ID {
			return dynamo.ErrConflict
		}
	}

	for _, s := range c.Sessions {
		s.Version++
		r.SessionMap[s.ID] = s
	}
	for _, s := range c.SessionsGone {
		delete(r.SessionMap, s.ID)
		delete(r.NotesMap, s.ID)
	}
	for _, p := range c.Packages {
		p.Version++
		r.PackageMap[p.ID] = p
	}
	for _, p := range c.PackagesGone {
		delete(r.PackageMap, p.ID)
	}
	for _, d := range c.Docs {
		d.Version++
		r.Docs[d.ID] = d
	}
	for _, d := range c.DocsGone {
		delete(r.Docs, d.ID)
	}
	for _, f := range c.FollowUps {
		f.Version++
		r.FollowUpMap[f.ID] = f
	}
	for _, f := range c.FollowUpsGone {
		delete(r.FollowUpMap, f.ID)
	}
	r.Revs = append(r.Revs, c.Revisions...)
	for _, bump := range c.Counters {
		r.Counters[bump.Key] = bump.Next
	}
	for _, s := range c.Shares {
		r.SharesMap[s.Change.New] = s.DocumentID
		if s.Change.Old != "" {
			delete(r.SharesMap, s.Change.Old)
		}
	}
	for _, e := range c.Externals {
		r.ExternalMap[e.Key()] = e
	}
	for _, id := range c.ExternalsGone {
		delete(r.ExternalMap, conflicts.Key(conflicts.SurfaceCalendar, id))
	}
	for _, key := range c.ConflictsGone {
		delete(r.ConflictMap, key)
	}
	for _, client := range c.Clients {
		existing := r.ClientMap[client.ID]
		existing.Activity, existing.LastSessionAt, existing.NextBookedAt = client.Activity, client.LastSessionAt, client.NextBookedAt
		r.ClientMap[client.ID] = existing
	}
	r.Writes++
	return nil
}

// oneWriteEach refuses a change that writes one item twice, as a DynamoDB
// transaction does, by the writes the real store would send.
func oneWriteEach(c book.Change) error {
	items, err := book.Items(c)
	if err != nil {
		return err
	}
	seen := map[string]bool{}
	for _, item := range items {
		key, err := keyOf(item)
		if err != nil {
			return err
		}
		if seen[key] && !c.Chunked {
			return fmt.Errorf("memory: a transaction writes %s twice", key)
		}
		seen[key] = true
	}
	return nil
}

func keyOf(item dynamo.TransactItem) (string, error) {
	switch {
	case item.Patch != nil:
		return item.Patch.PK + "/" + item.Patch.SK, nil
	case item.Delete != nil:
		return item.Delete[0] + "/" + item.Delete[1], nil
	case item.Put != nil:
		av, err := attributevalue.MarshalMap(item.Put)
		if err != nil {
			return "", err
		}
		pk, _ := av["PK"].(*types.AttributeValueMemberS)
		sk, _ := av["SK"].(*types.AttributeValueMemberS)
		if pk == nil || sk == nil {
			return "", errors.New("memory: a put without keys")
		}
		return pk.Value + "/" + sk.Value, nil
	}
	return "", errors.New("memory: an empty write")
}
