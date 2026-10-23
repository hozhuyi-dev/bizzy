package attachments_test

import (
	"testing"

	"bizzy-lambda/internal/features/attachments"
	"bizzy-lambda/internal/testutil/testapp"
)

// expense makes an expense to attach files to, returning its id.
func expense(t *testing.T, a *testapp.App) string {
	t.Helper()
	var e struct {
		ID string `json:"id"`
	}
	in := map[string]any{"date": "2026-10-01", "vendor": "Guardian", "lines": []map[string]any{
		{"name": "Kinesio tape", "categoryId": "purchases", "amountCents": 2500},
	}}
	if err := a.Must("expenses.create", in, &e); err != nil {
		t.Fatal(err)
	}
	return e.ID
}

// upload plays the browser: asks where to upload a photo and its
// thumbnail, uploads those it is told (the thumbnail only if withThumb),
// and confirms with what it says it sent.
func upload(t *testing.T, a *testapp.App, ownerID string, withThumb bool, extra map[string]any) attachments.View {
	t.Helper()
	var ticket attachments.Ticket
	if err := a.Must("attachments.requestUpload", map[string]any{
		"ownerKind": "expense", "ownerId": ownerID, "name": "receipt.jpg", "contentType": "image/jpeg",
		"sizeBytes": 400_000, "thumbnailBytes": 12_000,
	}, &ticket); err != nil {
		t.Fatal(err)
	}
	if ticket.ThumbnailUpload == nil {
		t.Fatal("no thumbnail upload offered")
	}
	if err := a.Blobs.Upload(attachments.KeyOf("expense", ownerID, ticket.ID, "image/jpeg")); err != nil {
		t.Fatal(err)
	}
	if withThumb {
		if err := a.Blobs.Upload(attachments.ThumbnailKeyOf("expense", ownerID, ticket.ID)); err != nil {
			t.Fatal(err)
		}
	}
	in := map[string]any{
		"ownerKind": "expense", "ownerId": ownerID, "id": ticket.ID, "name": "receipt.jpg",
		"contentType": "image/jpeg", "thumbnail": true,
	}
	for k, v := range extra {
		in[k] = v
	}
	var v attachments.View
	if err := a.Must("attachments.confirm", in, &v); err != nil {
		t.Fatal(err)
	}
	return v
}

func TestAPhotoKeepsItsThumbnailAndSizeBeforeShrinking(t *testing.T) {
	a := testapp.New()
	owner := expense(t, a)

	v := upload(t, a, owner, true, map[string]any{"originalBytes": 4_000_000})
	if v.ThumbnailURL == "" || v.OriginalBytes != 4_000_000 {
		t.Fatalf("thumbnail %q, original %d bytes; want a thumbnail and 4000000", v.ThumbnailURL, v.OriginalBytes)
	}

	// A thumbnail that never arrived leaves the file without one; an
	// "original" no bigger than the file wasn't shrunk.
	v = upload(t, a, owner, false, map[string]any{"originalBytes": 400_000})
	if v.ThumbnailURL != "" || v.OriginalBytes != 0 {
		t.Fatalf("thumbnail %q, original %d bytes; want neither", v.ThumbnailURL, v.OriginalBytes)
	}
}

func TestATooBigThumbnailIsNotOffered(t *testing.T) {
	a := testapp.New()
	var ticket attachments.Ticket
	if err := a.Must("attachments.requestUpload", map[string]any{
		"ownerKind": "expense", "ownerId": expense(t, a), "name": "scan.pdf", "contentType": "application/pdf",
		"sizeBytes": 400_000, "thumbnailBytes": attachments.ThumbnailMaxBytes + 1,
	}, &ticket); err != nil {
		t.Fatal(err)
	}
	if ticket.ThumbnailUpload != nil {
		t.Error("a thumbnail over the most was offered an upload")
	}
}

func TestReplacingAPhotoRemovesTheOldOneAndItsFiles(t *testing.T) {
	a := testapp.New()
	owner := expense(t, a)
	shrunk := upload(t, a, owner, true, map[string]any{"originalBytes": 4_000_000})

	full := upload(t, a, owner, true, map[string]any{"replaces": shrunk.ID})

	var list []attachments.View
	if err := a.Must("attachments.list", map[string]any{"ownerKind": "expense", "ownerId": owner}, &list); err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 || list[0].ID != full.ID {
		t.Fatalf("files %+v, want only the full-size one", list)
	}
	for _, key := range []string{
		attachments.KeyOf("expense", owner, shrunk.ID, "image/jpeg"),
		attachments.ThumbnailKeyOf("expense", owner, shrunk.ID),
	} {
		if _, ok := a.Blobs.Blobs[key]; ok {
			t.Errorf("%s is still stored", key)
		}
	}
}

func TestAPhotoReplacesOnlyOneBesideIt(t *testing.T) {
	a := testapp.New()
	other := upload(t, a, expense(t, a), true, nil)
	owner := expense(t, a)

	var ticket attachments.Ticket
	if err := a.Must("attachments.requestUpload", map[string]any{
		"ownerKind": "expense", "ownerId": owner, "name": "receipt.jpg", "contentType": "image/jpeg", "sizeBytes": 400_000,
	}, &ticket); err != nil {
		t.Fatal(err)
	}
	if err := a.Blobs.Upload(attachments.KeyOf("expense", owner, ticket.ID, "image/jpeg")); err != nil {
		t.Fatal(err)
	}
	_, refused, err := a.Call("attachments.confirm", map[string]any{
		"ownerKind": "expense", "ownerId": owner, "id": ticket.ID, "name": "receipt.jpg",
		"contentType": "image/jpeg", "replaces": other.ID,
	})
	if err != nil {
		t.Fatal(err)
	}
	if refused == nil {
		t.Fatal("replaced another expense's file")
	}
}

func TestRemovingAFileDeletesItsThumbnailToo(t *testing.T) {
	a := testapp.New()
	owner := expense(t, a)
	v := upload(t, a, owner, true, nil)

	if err := a.Must("attachments.delete", map[string]any{"id": v.ID}, nil); err != nil {
		t.Fatal(err)
	}
	if n := len(a.Blobs.Blobs); n != 0 {
		t.Errorf("%d files still stored: %v", n, a.Blobs.Blobs)
	}
}

// A list counts every owner's files in one read, as each owner's own count
// would say; an expense without one has none.
func TestCountsAreEachOwnersFiles(t *testing.T) {
	a := testapp.New()
	one, two, none := expense(t, a), expense(t, a), expense(t, a)
	upload(t, a, one, false, nil)
	upload(t, a, two, false, nil)
	upload(t, a, two, false, nil)

	var page struct {
		Items []struct {
			ID    string `json:"id"`
			Files int    `json:"files"`
		} `json:"items"`
	}
	if err := a.Must("expenses.search", map[string]any{}, &page); err != nil {
		t.Fatal(err)
	}
	want := map[string]int{one: 1, two: 2, none: 0}
	for _, e := range page.Items {
		if e.Files != want[e.ID] {
			t.Errorf("expense %s: %d files, want %d", e.ID, e.Files, want[e.ID])
		}
	}
	var missing struct{ Items []struct{ ID string } }
	if err := a.Must("expenses.search", map[string]any{"receipts": []string{"missing"}}, &missing); err != nil {
		t.Fatal(err)
	}
	if len(missing.Items) != 1 || missing.Items[0].ID != none {
		t.Errorf("without a receipt = %+v, want only %s", missing.Items, none)
	}
}
