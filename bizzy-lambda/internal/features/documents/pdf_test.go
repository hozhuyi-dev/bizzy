package documents_test

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"testing"

	"bizzy-lambda/internal/features/documents"
	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/testutil/memblob"
	"bizzy-lambda/internal/testutil/testapp"
)

func pdfOf(t *testing.T, a *testapp.App, id string) documents.File {
	t.Helper()
	var f documents.File
	if err := a.Must("documents.pdf", map[string]any{"id": id}, &f); err != nil {
		t.Fatal(err)
	}
	return f
}

func hash(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

// An issued document's PDF is printed once, kept, and served as kept from
// then on: printed again only if the store lost it, and never served if
// the stored file isn't the one issued.
func TestIssuedPDFIsKept(t *testing.T) {
	a, jane, ss := setup(t)
	if err := a.Must("clients.update", map[string]any{"id": jane, "idNo": "900101 14 5678"}, nil); err != nil {
		t.Fatal(err)
	}
	var d documents.View
	if err := a.Must("documents.issue", map[string]any{"id": ss[0].Invoice.ID}, &d); err != nil {
		t.Fatal(err)
	}
	if got := d.Content.Recipient.IDNo; got != "900101-14-5678" {
		t.Errorf("printed IC %q", got)
	}
	key := documents.PDFKeyPrefix + d.ID + "/00.pdf"
	stored, ok := a.Blobs.Blobs[key]
	if !ok || len(d.Revisions) != 1 || hash(stored.Body) != d.Revisions[0].PDFSha256 {
		t.Fatalf("issuing kept %v at %s, revisions %+v", ok, key, d.Revisions)
	}

	f := pdfOf(t, a, d.ID)
	if !bytes.Equal(f.Data, stored.Body) || !strings.HasSuffix(f.Name, "-00 Jane Smith.pdf") {
		t.Errorf("served %s, not the stored file", f.Name)
	}

	delete(a.Blobs.Blobs, key)
	if f := pdfOf(t, a, d.ID); !bytes.Equal(f.Data, stored.Body) || !bytes.Equal(a.Blobs.Blobs[key].Body, stored.Body) {
		t.Error("a lost PDF wasn't printed and kept again as issued")
	}

	a.Blobs.Blobs[key] = memblob.Blob{Body: []byte("%PDF-1.3 something else")}
	if _, refused, err := a.Call("documents.pdf", map[string]any{"id": d.ID}); err == nil && refused == nil {
		t.Error("served a stored file that isn't the one issued")
	}
	a.Blobs.Blobs[key] = stored

	if err := a.Must("documents.cancel", map[string]any{"id": d.ID, "reason": "Wrong fee"}, nil); err != nil {
		t.Fatal(err)
	}
	if f := pdfOf(t, a, d.ID); bytes.Equal(f.Data, stored.Body) || !bytes.Equal(a.Blobs.Blobs[key].Body, stored.Body) {
		t.Error("a cancelled document's PDF isn't stamped over the kept one")
	}
}

func TestDraftsPreviewAndHaveNoPDF(t *testing.T) {
	a, _, ss := setup(t)
	var d documents.View
	if err := a.Must("documents.get", map[string]any{"id": ss[1].Invoice.ID}, &d); err != nil {
		t.Fatal(err)
	}
	if _, refused, err := a.Call("documents.pdf", map[string]any{"id": d.ID}); err != nil || refused == nil || refused.Code != apperr.CodeRefused {
		t.Errorf("a draft's PDF: refused %+v, %v", refused, err)
	}

	content := *d.Draft
	content.Notes = "Unsaved"
	var f documents.File
	if err := a.Must("documents.preview", map[string]any{"id": d.ID, "content": content}, &f); err != nil {
		t.Fatal(err)
	}
	if !bytes.HasPrefix(f.Data, []byte("%PDF")) || !strings.HasPrefix(f.Name, "Draft ") {
		t.Errorf("preview %q", f.Name)
	}
	if len(a.Blobs.Blobs) != 0 {
		t.Errorf("a preview was kept: %v", a.Blobs.Blobs)
	}
}
