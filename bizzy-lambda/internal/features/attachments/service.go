package attachments

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/platform/blobstore"
	"bizzy-lambda/internal/platform/dynamo"
)

// Store is the attachment items.
type Store interface {
	// List returns one owner's attachments, oldest first.
	List(ctx context.Context, kind OwnerKind, ownerID string) ([]Attachment, error)
	// ListAll returns every attachment, by owner.
	ListAll(ctx context.Context) ([]Attachment, error)
	Get(ctx context.Context, kind OwnerKind, ownerID, id string) (Attachment, bool, error)
	Put(ctx context.Context, a Attachment) error
	Delete(ctx context.Context, a Attachment) error
}

// Owner is what files hang off. Its feature implements it (sessions.Files,
// expenses.Files) without depending on this package.
type Owner interface {
	// CanAttach reports whether files can be added to it or removed now,
	// as the error to show.
	CanAttach(ctx context.Context, id string) error
	// SetFiles records how many files it has.
	SetFiles(ctx context.Context, id string, n int) error
	// Exists reports whether it is still there.
	Exists(ctx context.Context, id string) (bool, error)
}

// Service keeps the items, the files and the owners' counts in step.
type Service struct {
	Repo   Store
	Blobs  blobstore.Store
	Owners map[OwnerKind]Owner
	Now    func() time.Time
}

// Links are short-lived: long enough to look through a session's photos,
// short enough that a link pasted somewhere stops working.
const (
	uploadExpiry = 15 * time.Minute
	linkExpiry   = time.Hour
)

// ErrNotUploaded is a confirm for a file that never arrived.
var ErrNotUploaded = apperr.Conflict("The file didn't finish uploading. Try attaching it again.")

func (s Service) owner(kind OwnerKind) (Owner, error) {
	o, ok := s.Owners[kind]
	if !ok {
		return nil, apperr.Invalid("files can't be attached to a %q", kind)
	}
	return o, nil
}

// UploadInput is a file the browser is about to upload.
type UploadInput struct {
	OwnerKind   OwnerKind `json:"ownerKind"`
	OwnerID     string    `json:"ownerId"`
	Name        string    `json:"name"`
	ContentType string    `json:"contentType"`
	SizeBytes   int64     `json:"sizeBytes"`
}

// Ticket is where to upload, and the id to confirm it under.
type Ticket struct {
	ID     string           `json:"id"`
	Upload blobstore.Upload `json:"upload"`
}

// RequestUpload checks a file can be attached and presigns its upload.
// Nothing is stored until it is confirmed.
func (s Service) RequestUpload(ctx context.Context, in UploadInput) (Ticket, error) {
	o, err := s.owner(in.OwnerKind)
	if err != nil {
		return Ticket{}, err
	}
	if err := checkFile(in.Name, in.ContentType, in.SizeBytes); err != nil {
		return Ticket{}, err
	}
	if err := o.CanAttach(ctx, in.OwnerID); err != nil {
		return Ticket{}, err
	}
	id := dynamo.NewID()
	up, err := s.Blobs.PresignPut(ctx, KeyOf(in.OwnerKind, in.OwnerID, id, in.ContentType), in.ContentType, in.SizeBytes, uploadExpiry)
	if err != nil {
		return Ticket{}, err
	}
	return Ticket{ID: id, Upload: up}, nil
}

// ConfirmInput is an uploaded file to keep.
type ConfirmInput struct {
	OwnerKind   OwnerKind `json:"ownerKind"`
	OwnerID     string    `json:"ownerId"`
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	ContentType string    `json:"contentType"`
}

// Confirm keeps an uploaded file: it checks what arrived, writes its item
// and updates the owner's count. Confirming twice keeps it once.
func (s Service) Confirm(ctx context.Context, in ConfirmInput) (View, error) {
	o, err := s.owner(in.OwnerKind)
	if err != nil {
		return View{}, err
	}
	if in.ID == "" {
		return View{}, apperr.Invalid("which upload?")
	}
	if existing, found, err := s.Repo.Get(ctx, in.OwnerKind, in.OwnerID, in.ID); err != nil {
		return View{}, err
	} else if found {
		return s.view(ctx, existing)
	}
	if err := o.CanAttach(ctx, in.OwnerID); err != nil {
		return View{}, err
	}
	if _, ok := Types[in.ContentType]; !ok {
		return View{}, ErrNotUploaded
	}

	key := KeyOf(in.OwnerKind, in.OwnerID, in.ID, in.ContentType)
	obj, err := s.Blobs.Confirm(ctx, key)
	if errors.Is(err, blobstore.ErrMissing) {
		return View{}, ErrNotUploaded
	}
	if err != nil {
		return View{}, err
	}
	a := Attachment{
		ID: in.ID, OwnerKind: in.OwnerKind, OwnerID: in.OwnerID,
		Name: cleanName(in.Name), ContentType: obj.ContentType, SizeBytes: obj.Size,
		Key: key, UploadedAt: s.Now().UTC(),
	}
	if err := checkFile(a.Name, a.ContentType, a.SizeBytes); err != nil {
		// The signed upload pins the type and size, so this is only a
		// file that was swapped: it isn't kept.
		_ = s.Blobs.Delete(ctx, key)
		return View{}, err
	}
	if err := s.Repo.Put(ctx, a); err != nil {
		return View{}, err
	}
	if err := s.count(ctx, o, a.OwnerKind, a.OwnerID); err != nil {
		return View{}, err
	}
	return s.view(ctx, a)
}

// List returns an owner's files with links to them.
func (s Service) List(ctx context.Context, kind OwnerKind, ownerID string) ([]View, error) {
	if _, err := s.owner(kind); err != nil {
		return nil, err
	}
	all, err := s.Repo.List(ctx, kind, ownerID)
	if err != nil {
		return nil, err
	}
	out := make([]View, 0, len(all))
	for _, a := range all {
		v, err := s.view(ctx, a)
		if err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, nil
}

// Remove deletes one file she attached by mistake.
func (s Service) Remove(ctx context.Context, kind OwnerKind, ownerID, id string) error {
	o, err := s.owner(kind)
	if err != nil {
		return err
	}
	a, found, err := s.Repo.Get(ctx, kind, ownerID, id)
	if err != nil {
		return err
	}
	if !found {
		return apperr.NotFound("This file was already removed.")
	}
	if err := o.CanAttach(ctx, ownerID); err != nil {
		return err
	}
	// Counted without it first: should the request die before the item
	// goes, the count is one short, which Heal finds from the items.
	all, err := s.Repo.List(ctx, kind, ownerID)
	if err != nil {
		return err
	}
	if err := o.SetFiles(ctx, ownerID, len(all)-1); err != nil {
		return err
	}
	if err := s.Repo.Delete(ctx, a); err != nil {
		return err
	}
	return s.Blobs.Delete(ctx, a.Key)
}

// Sweep deletes the files no attachment has that were last written before
// cutoff: those a request that died partway left behind (see Heal). The
// cutoff leaves alone an upload under way, and a pending one the bucket
// expires itself. It returns how many it deleted.
func (s Service) Sweep(ctx context.Context, cutoff time.Time) (int, error) {
	all, err := s.Repo.ListAll(ctx)
	if err != nil {
		return 0, err
	}
	attached := make(map[string]bool, len(all))
	for _, a := range all {
		attached[a.Key] = true
	}
	files, err := s.Blobs.List(ctx, KeyPrefix)
	if err != nil {
		return 0, err
	}
	var stray []string
	for _, f := range files {
		if !attached[f.Key] && f.Modified.Before(cutoff) {
			stray = append(stray, f.Key)
		}
	}
	return len(stray), s.Blobs.Delete(ctx, stray...)
}

// Heal puts the items and the owners' counts back in step after a request
// died partway: the items of an owner that is gone go, with their files,
// and every other owner counts its items. Each step is ordered so a crash
// leaves only a count short, or items of an owner gone, both found from the
// items; a file left without its item is the sweep's (see Sweep).
func (s Service) Heal(ctx context.Context) error {
	all, err := s.Repo.ListAll(ctx)
	if err != nil {
		return err
	}
	type owner struct {
		kind OwnerKind
		id   string
	}
	byOwner := map[owner][]Attachment{}
	var order []owner
	for _, a := range all {
		key := owner{a.OwnerKind, a.OwnerID}
		if _, seen := byOwner[key]; !seen {
			order = append(order, key)
		}
		byOwner[key] = append(byOwner[key], a)
	}
	for _, key := range order {
		o, err := s.owner(key.kind)
		if err != nil {
			return err
		}
		exists, err := o.Exists(ctx, key.id)
		if err != nil {
			return err
		}
		if !exists {
			if err := s.DeleteOwner(ctx, key.kind, key.id); err != nil {
				return err
			}
			continue
		}
		if err := o.SetFiles(ctx, key.id, len(byOwner[key])); err != nil {
			return err
		}
	}
	return nil
}

// DeleteOwner deletes every file of an owner that is gone. It leaves the
// owner alone: there is nothing left to count on.
func (s Service) DeleteOwner(ctx context.Context, kind OwnerKind, ownerID string) error {
	all, err := s.Repo.List(ctx, kind, ownerID)
	if err != nil || len(all) == 0 {
		return err
	}
	// Items first: should the files then fail to go, what is left is a
	// stray file nothing links to, never an item without its file.
	keys := make([]string, len(all))
	for i, a := range all {
		keys[i] = a.Key
		if err := s.Repo.Delete(ctx, a); err != nil {
			return err
		}
	}
	return s.Blobs.Delete(ctx, keys...)
}

func (s Service) count(ctx context.Context, o Owner, kind OwnerKind, ownerID string) error {
	all, err := s.Repo.List(ctx, kind, ownerID)
	if err != nil {
		return err
	}
	return o.SetFiles(ctx, ownerID, len(all))
}

func (s Service) view(ctx context.Context, a Attachment) (View, error) {
	url, err := s.Blobs.PresignGet(ctx, a.Key, a.Name, false, linkExpiry)
	if err != nil {
		return View{}, err
	}
	download, err := s.Blobs.PresignGet(ctx, a.Key, a.Name, true, linkExpiry)
	if err != nil {
		return View{}, err
	}
	return View{Attachment: a, URL: url, DownloadURL: download}, nil
}

func checkFile(name, contentType string, size int64) error {
	switch {
	case cleanName(name) == "":
		return apperr.Invalid("the file needs a name")
	case size <= 0:
		return apperr.Invalid("%s is empty", name)
	case size > MaxBytes:
		return apperr.Invalid("%s is %s; files can be up to %d MB", name, megabytes(size), MaxBytes>>20)
	}
	if _, ok := Types[contentType]; !ok {
		return apperr.Invalid("%s isn't a photo or PDF; attach %s files", name, typeNames())
	}
	return nil
}

func megabytes(size int64) string {
	return fmt.Sprintf("%.1f MB", float64(size)/(1<<20))
}

func typeNames() string {
	var names []string
	for _, ext := range Types {
		names = append(names, strings.ToUpper(strings.TrimPrefix(ext, ".")))
	}
	slices.Sort(names)
	return strings.Join(names, ", ")
}
