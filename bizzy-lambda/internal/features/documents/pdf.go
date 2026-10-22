package documents

// PDFs: issuing a revision prints it (Render) and keeps the hash of the
// file with the revision; after the commit, the issue route puts the file
// in the file store, where production locks it for 7 years. From then on
// the revision's PDF is always the stored file, so changing the layout
// never changes a document already issued. A file the store lost (the
// upload after issuing failed) is printed again, and must come out as
// issued, or the layout changed since and serving it is an error.
//
// Drafts are printed afresh every time, watermarked DRAFT, and never
// stored.

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"

	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/platform/blobstore"
	"bizzy-lambda/internal/platform/pdflayout"
	"bizzy-lambda/internal/platform/txn"
)

// PDFKeyPrefix is where every issued PDF's key starts in the file store:
// documents/<documentId>/NN.pdf.
const PDFKeyPrefix = "documents/"

// PDFKey is where an issued revision's PDF is kept.
func PDFKey(r *Revision) string {
	return fmt.Sprintf("%s%s/%02d.pdf", PDFKeyPrefix, r.DocumentID, r.Revision)
}

func checksum(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

// File is a PDF as the app gets it.
type File struct {
	Name string `json:"name"`
	// Data is the PDF: base64 in JSON.
	Data []byte `json:"data"`
}

// IssuedRevision is the revision of a document that counts: its latest
// issued.
func IssuedRevision(tx *txn.Tx, d *Document) (*Revision, error) {
	if !d.Issued() {
		return nil, apperr.Refused("Only an issued document has a PDF of its own; preview the draft instead.")
	}
	return Revisions.Get(tx, revisionID(d.ID, *d.Revision))
}

// IssuedPDF is an issued revision's PDF, as stored. One missing is printed
// again, and stored too when store is set (the API's role may write; the
// share link's may not).
func IssuedPDF(ctx context.Context, blobs blobstore.Store, t Type, r *Revision, store bool) ([]byte, error) {
	key := PDFKey(r)
	stored, err := blobs.Get(ctx, key)
	switch {
	case err == nil:
		if checksum(stored) != r.PDFSha256 {
			return nil, fmt.Errorf("documents: the stored PDF of %s isn't the one issued", Label(r.Number, r.Revision))
		}
		return stored, nil
	case !errors.Is(err, blobstore.ErrMissing):
		return nil, err
	}
	printed, err := Render(PrintedRevision(t, r))
	if err != nil {
		return nil, err
	}
	if checksum(printed) != r.PDFSha256 {
		return nil, fmt.Errorf("documents: the PDF of %s isn't stored, and the layout changed since it was issued", Label(r.Number, r.Revision))
	}
	if store {
		if err := blobs.Put(ctx, key, "application/pdf", printed); err != nil {
			return nil, err
		}
	}
	return printed, nil
}

// ServedPDF is the PDF of a revision of a document as anyone gets it: as
// issued, with CANCELLED stamped over it once the document is.
func ServedPDF(ctx context.Context, blobs blobstore.Store, d *Document, r *Revision, store bool) (File, error) {
	p := PrintedRevision(d.Type, r)
	pdf, err := IssuedPDF(ctx, blobs, d.Type, r, store)
	if err == nil && d.Status == StatusCancelled {
		pdf, err = pdflayout.Stamp(pdf, p.info(), Cancelled)
	}
	return File{Name: p.FileName(), Data: pdf}, err
}

// keepIssued stores the PDF of a revision just issued. The issue stands if
// it fails: the next time the PDF is asked for, it is printed and stored
// then.
func keepIssued(ctx context.Context, blobs blobstore.Store, v *View) {
	for i := range v.Revisions {
		r := &v.Revisions[i]
		if v.Revision == nil || r.Revision != *v.Revision {
			continue
		}
		if _, err := IssuedPDF(ctx, blobs, v.Type, r, true); err != nil {
			slog.ErrorContext(ctx, "store an issued PDF", "document", v.ID, "revision", r.Revision, "error", err)
		}
	}
}

// preview is a draft as it would print if issued now: from content as
// the editor has it, unsaved, watermarked DRAFT.
func preview(tx *txn.Tx, d *Document, in Content) (File, error) {
	c, err := Normalize(in)
	if err != nil {
		return File{}, err
	}
	now := tx.Now()
	if c.Date == "" {
		c.Date = now.In(tx.Location()).Format("2006-01-02")
	}
	p := Printed{Type: d.Type, Number: d.Number, Content: c, Draft: true, At: now.UTC()}
	if d.Issued() {
		p.Revision = *d.Revision + 1
	}
	pdf, err := Render(p)
	return File{Name: p.FileName(), Data: pdf}, err
}
