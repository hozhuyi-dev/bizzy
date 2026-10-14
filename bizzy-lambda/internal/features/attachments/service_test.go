package attachments_test

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"bizzy-lambda/internal/features/attachments"
	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/testutil/memblob"
	"bizzy-lambda/internal/testutil/memory"
)

// owner is a session or expense that counts its files and may refuse them.
type owner struct {
	files  map[string]int
	refuse error
	// gone are owners deleted meanwhile.
	gone map[string]bool
}

func (o *owner) Exists(_ context.Context, id string) (bool, error) { return !o.gone[id], nil }

func (o *owner) CanAttach(context.Context, string) error { return o.refuse }

func (o *owner) SetFiles(_ context.Context, id string, n int) error {
	o.files[id] = n
	return nil
}

func setup() (attachments.Service, *memblob.Store, *owner) {
	blobs := memblob.New()
	o := &owner{files: map[string]int{}}
	now := time.Date(2026, 10, 13, 9, 0, 0, 0, time.UTC)
	return attachments.Service{
		Repo:   memory.New().Attachments(),
		Blobs:  blobs,
		Owners: map[attachments.OwnerKind]attachments.Owner{attachments.OwnerSession: o},
		Now:    func() time.Time { return now },
	}, blobs, o
}

// attach does what the app does: ask, upload, confirm.
func attach(t *testing.T, s attachments.Service, blobs *memblob.Store, name, contentType string) attachments.View {
	t.Helper()
	ctx := context.Background()
	ticket, err := s.RequestUpload(ctx, attachments.UploadInput{
		OwnerKind: attachments.OwnerSession, OwnerID: "e1", Name: name, ContentType: contentType, SizeBytes: 1000,
	})
	if err != nil {
		t.Fatalf("RequestUpload: %v", err)
	}
	if err := blobs.Put(attachments.KeyOf(attachments.OwnerSession, "e1", ticket.ID, contentType)); err != nil {
		t.Fatalf("upload: %v", err)
	}
	v, err := s.Confirm(ctx, attachments.ConfirmInput{
		OwnerKind: attachments.OwnerSession, OwnerID: "e1", ID: ticket.ID, Name: name, ContentType: contentType,
	})
	if err != nil {
		t.Fatalf("Confirm: %v", err)
	}
	return v
}

func TestAttachListRemove(t *testing.T) {
	ctx := context.Background()
	s, blobs, o := setup()

	photo := attach(t, s, blobs, `C:\Photos\knee.jpg`, "image/jpeg")
	attach(t, s, blobs, "MRI report.pdf", "application/pdf")

	if photo.Name != "knee.jpg" || photo.SizeBytes != 1000 || photo.URL == "" || photo.DownloadURL == "" {
		t.Errorf("photo = %+v, want its own name, size and links", photo)
	}
	if want := "attachments/session/e1/" + photo.ID + "/original.jpg"; photo.Key != want {
		t.Errorf("key = %q, want %q", photo.Key, want)
	}
	if blobs.Blobs[photo.Key].Pending {
		t.Error("a confirmed file is still pending, so the bucket would expire it")
	}
	if o.files["e1"] != 2 {
		t.Errorf("owner counts %d files, want 2", o.files["e1"])
	}

	if err := s.Remove(ctx, attachments.OwnerSession, "e1", photo.ID); err != nil {
		t.Fatalf("Remove: %v", err)
	}
	list, _ := s.List(ctx, attachments.OwnerSession, "e1")
	if len(list) != 1 || list[0].Name != "MRI report.pdf" || o.files["e1"] != 1 {
		t.Errorf("after removing: %d listed, %d counted; want the PDF only", len(list), o.files["e1"])
	}
	if _, ok := blobs.Blobs[photo.Key]; ok {
		t.Error("the removed photo's file is still stored")
	}

	if err := s.DeleteOwner(ctx, attachments.OwnerSession, "e1"); err != nil {
		t.Fatalf("DeleteOwner: %v", err)
	}
	if list, _ := s.List(ctx, attachments.OwnerSession, "e1"); len(list) != 0 || len(blobs.Blobs) != 0 {
		t.Errorf("after deleting the owner: %d listed, %d files", len(list), len(blobs.Blobs))
	}
}

func TestConfirmIsIdempotent(t *testing.T) {
	s, blobs, o := setup()
	v := attach(t, s, blobs, "knee.jpg", "image/jpeg")
	again, err := s.Confirm(context.Background(), attachments.ConfirmInput{
		OwnerKind: attachments.OwnerSession, OwnerID: "e1", ID: v.ID, Name: "knee.jpg", ContentType: "image/jpeg",
	})
	if err != nil || again.ID != v.ID || o.files["e1"] != 1 {
		t.Errorf("confirming twice: %v, %d files counted; want the same one", err, o.files["e1"])
	}
}

func TestRefusals(t *testing.T) {
	ctx := context.Background()
	s, _, o := setup()
	ask := func(name, contentType string, size int64) error {
		_, err := s.RequestUpload(ctx, attachments.UploadInput{
			OwnerKind: attachments.OwnerSession, OwnerID: "e1", Name: name, ContentType: contentType, SizeBytes: size,
		})
		return err
	}

	for name, err := range map[string]error{
		"not a photo or PDF": ask("scan.tiff", "image/tiff", 10),
		"too large":          ask("video.jpg", "image/jpeg", attachments.MaxBytes+1),
		"empty":              ask("empty.jpg", "image/jpeg", 0),
		"no name":            ask("  ", "image/jpeg", 10),
	} {
		var appErr *apperr.Error
		if !errors.As(err, &appErr) || appErr.Code != apperr.CodeInvalid {
			t.Errorf("%s: error = %v, want invalid", name, err)
		}
	}

	if _, err := s.RequestUpload(ctx, attachments.UploadInput{OwnerKind: "client", OwnerID: "c1", Name: "a.jpg", ContentType: "image/jpeg", SizeBytes: 1}); err == nil {
		t.Error("attached to an owner kind no feature serves")
	}

	o.refuse = apperr.Conflict("Restore the session before changing its files.")
	if err := ask("knee.jpg", "image/jpeg", 10); err != o.refuse {
		t.Errorf("owner refusing: error = %v, want the owner's", err)
	}

	o.refuse = nil
	ticket, _ := s.RequestUpload(ctx, attachments.UploadInput{OwnerKind: attachments.OwnerSession, OwnerID: "e1", Name: "a.jpg", ContentType: "image/jpeg", SizeBytes: 10})
	_, err := s.Confirm(ctx, attachments.ConfirmInput{OwnerKind: attachments.OwnerSession, OwnerID: "e1", ID: ticket.ID, Name: "a.jpg", ContentType: "image/jpeg"})
	if err != attachments.ErrNotUploaded {
		t.Errorf("confirming before the upload arrived: %v, want ErrNotUploaded", err)
	}
	if !strings.Contains(attachments.KeyOf(attachments.OwnerExpense, "x1", "a1", "application/pdf"), "attachments/expense/x1/a1/original.pdf") {
		t.Error("expense keys follow the same layout")
	}
}

// After a request died partway, Heal counts each owner's items again and
// drops the items, and files, of an owner that is gone.
func TestHeal(t *testing.T) {
	ctx := context.Background()
	svc, blobs, o := setup()
	o.gone = map[string]bool{}
	for _, owner := range []string{"e1", "e2"} {
		up, err := svc.RequestUpload(ctx, attachments.UploadInput{OwnerKind: attachments.OwnerSession, OwnerID: owner, Name: "a.jpg", ContentType: "image/jpeg", SizeBytes: 10})
		if err != nil {
			t.Fatal(err)
		}
		key := attachments.KeyOf(attachments.OwnerSession, owner, up.ID, "image/jpeg")
		if err := blobs.Put(key); err != nil {
			t.Fatal(err)
		}
		if _, err := svc.Confirm(ctx, attachments.ConfirmInput{OwnerKind: attachments.OwnerSession, OwnerID: owner, ID: up.ID, Name: "a.jpg", ContentType: "image/jpeg"}); err != nil {
			t.Fatal(err)
		}
	}
	// e1's count was lost, and e2 was deleted before its files went.
	o.files["e1"] = 0
	o.gone["e2"] = true

	if err := svc.Heal(ctx); err != nil {
		t.Fatal(err)
	}
	if o.files["e1"] != 1 {
		t.Errorf("e1 counts %d, want 1", o.files["e1"])
	}
	if left, _ := svc.Repo.List(ctx, attachments.OwnerSession, "e2"); len(left) != 0 {
		t.Errorf("e2's attachments %v, want gone", left)
	}
	if len(blobs.Blobs) != 1 {
		t.Errorf("files %v, want only e1's", blobs.Blobs)
	}
}

// Sweep deletes the files no attachment links to, and leaves the rest.
func TestSweep(t *testing.T) {
	ctx := context.Background()
	svc, blobs, _ := setup()
	up, err := svc.RequestUpload(ctx, attachments.UploadInput{OwnerKind: attachments.OwnerSession, OwnerID: "e1", Name: "a.jpg", ContentType: "image/jpeg", SizeBytes: 10})
	if err != nil {
		t.Fatal(err)
	}
	kept := attachments.KeyOf(attachments.OwnerSession, "e1", up.ID, "image/jpeg")
	if err := blobs.Put(kept); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Confirm(ctx, attachments.ConfirmInput{OwnerKind: attachments.OwnerSession, OwnerID: "e1", ID: up.ID, Name: "a.jpg", ContentType: "image/jpeg"}); err != nil {
		t.Fatal(err)
	}
	stray := attachments.KeyPrefix + "session/e2/x/original.jpg"
	blobs.Blobs[stray] = memblob.Blob{Size: 10, ContentType: "image/jpeg"}

	deleted, err := svc.Sweep(ctx, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := blobs.Blobs[kept]; deleted != 1 || !ok || len(blobs.Blobs) != 1 {
		t.Errorf("deleted %d, files %v: want only the stray one gone", deleted, blobs.Blobs)
	}
}
