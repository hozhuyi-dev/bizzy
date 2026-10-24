// Package snapshot is one environment's data taken whole, to try the app
// on elsewhere: copied into a test environment (cmd/copy), or replayed in
// memory (the simulation's TestReplay). It leaves out what ties the data
// to its own Google account: the connection, the sync's state, the event
// links and conflicts.
//
// Both take it the same way: Take reads the table as of one moment and
// the issued PDFs; Load puts it in a memory table, at its own schema with
// the fence up, so the code's migrations (migrate.Run) bring it to this
// code's version and check it before anything is done with it.
package snapshot

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	"maps"
	"slices"

	"codeberg.org/go-pdf/fpdf"

	"bizzy-lambda/internal/features/attachments"
	"bizzy-lambda/internal/features/conflicts"
	"bizzy-lambda/internal/features/documents"
	"bizzy-lambda/internal/features/googleconnect"
	"bizzy-lambda/internal/features/googlesync"
	"bizzy-lambda/internal/platform/blobstore"
	"bizzy-lambda/internal/platform/table"
	"bizzy-lambda/internal/platform/txn"
)

// Left are the partitions a snapshot leaves out: the source's Google
// connection, the sync's state, event links and conflicts, which belong
// to its own calendar, and the schema (Snapshot.Schema has it).
var Left = []string{
	googleconnect.Connections.Name, googlesync.States.Name, googlesync.Links.Name,
	conflicts.Conflicts.Name, txn.SchemaKey.PK,
}

type Snapshot struct {
	Items  []table.Item
	Schema txn.Schema
	// Account is the source's Google account; "" when not connected.
	Account string
	// PDFs are the issued PDFs as kept, by key.
	PDFs map[string][]byte
}

// takeAttempts bounds how often Take reads again while commits land.
const takeAttempts = 3

// Take reads a table whole as of one moment, reading again when a commit
// landed meanwhile, and the issued PDFs in files.
func Take(ctx context.Context, tb table.Table, files blobstore.Store) (Snapshot, error) {
	var all []table.Item
	for attempt := 1; ; attempt++ {
		before, err := tb.Versions(ctx, txn.Commits)
		if err != nil {
			return Snapshot{}, err
		}
		if all, err = tb.Scan(ctx); err != nil {
			return Snapshot{}, err
		}
		after, err := tb.Versions(ctx, txn.Commits)
		if err != nil {
			return Snapshot{}, err
		}
		if maps.Equal(before, after) {
			break
		}
		if attempt == takeAttempts {
			return Snapshot{}, fmt.Errorf("snapshot: the table changed while read, %d times: try again when it is quiet", attempt)
		}
	}

	var s Snapshot
	for _, it := range all {
		switch it.PK {
		case txn.SchemaKey.PK:
			if err := json.Unmarshal(it.Data, &s.Schema); err != nil {
				return Snapshot{}, fmt.Errorf("snapshot: schema: %w", err)
			}
		case googleconnect.Connections.Name:
			var c googleconnect.Connection
			if err := json.Unmarshal(it.Data, &c); err == nil {
				s.Account = c.Email
			}
		}
		if !slices.Contains(Left, it.PK) {
			s.Items = append(s.Items, it)
		}
	}

	listed, err := files.List(ctx, documents.PDFKeyPrefix)
	if err != nil {
		return Snapshot{}, err
	}
	s.PDFs = map[string][]byte{}
	for _, f := range listed {
		if s.PDFs[f.Key], err = files.Get(ctx, f.Key); err != nil {
			return Snapshot{}, err
		}
	}
	return s, nil
}

// Load puts the snapshot in an empty table at its own schema, fenced:
// migrate.Run then always runs over it, rewriting every item as this
// code writes it and checking every invariant, as a deploy does.
func (s Snapshot) Load(ctx context.Context, tb table.Table) error {
	fence := txn.SchemaItem(txn.Schema{Version: s.Schema.Version, Migrating: true})
	return Write(ctx, tb, append(slices.Clone(s.Items), fence))
}

// Write writes items as they are, index keys and all, as the only writer
// (a fence keeps the app out). It commits them a batch at a time, so
// every partition's version moves on: what a Runner read of one before
// is read again (see txn's cache), as a partition at 0 must be empty.
func Write(ctx context.Context, tb table.Table, items []table.Item) error {
	for batch := range slices.Chunk(items, table.MaxWrites) {
		read, err := tb.Versions(ctx, txn.Commits)
		if err != nil {
			return err
		}
		writes := make([]table.Write, len(batch))
		for i := range batch {
			writes[i] = table.Write{Put: &batch[i]}
			read[batch[i].PK] = read[batch[i].PK]
		}
		if _, err := tb.Commit(ctx, txn.Commits, read, writes); err != nil {
			return err
		}
	}
	return nil
}

// Files puts the snapshot's files in a store for the items (as this code
// reads them, so after Load's migration): the issued PDFs as they were
// kept, and a placeholder for every attachment and its thumbnail. It
// returns how many attachments it stood in for.
func (s Snapshot) Files(ctx context.Context, items []table.Item, dst blobstore.Store) (int, error) {
	for _, key := range slices.Sorted(maps.Keys(s.PDFs)) {
		if err := dst.Put(ctx, key, "application/pdf", s.PDFs[key]); err != nil {
			return 0, err
		}
	}
	photo, file, err := placeholders()
	if err != nil {
		return 0, err
	}
	n := 0
	for _, it := range items {
		if it.PK != attachments.Attachments.Name {
			continue
		}
		var at attachments.Attachment
		if err := json.Unmarshal(it.Data, &at); err != nil {
			return n, fmt.Errorf("attachment %s: %w", it.SK, err)
		}
		body := photo
		if at.ContentType == "application/pdf" {
			body = file
		}
		if err := dst.Put(ctx, at.Key, at.ContentType, body); err != nil {
			return n, err
		}
		if at.ThumbnailKey != "" {
			if err := dst.Put(ctx, at.ThumbnailKey, "image/jpeg", photo); err != nil {
				return n, err
			}
		}
		n++
	}
	return n, nil
}

// placeholders are what stands in for an attachment: a small grey JPEG
// for a photo (a browser shows it whatever type it is served as), and a
// one-page PDF.
func placeholders() (photo, file []byte, err error) {
	img := image.NewRGBA(image.Rect(0, 0, 160, 120))
	draw.Draw(img, img.Bounds(), &image.Uniform{C: color.Gray{Y: 200}}, image.Point{}, draw.Src)
	var p bytes.Buffer
	if err := jpeg.Encode(&p, img, nil); err != nil {
		return nil, nil, err
	}
	pdf := fpdf.New("P", "mm", "A4", "")
	pdf.AddPage()
	pdf.SetFont("Helvetica", "", 14)
	pdf.Cell(0, 10, "A placeholder: the file is in the environment this was copied from.")
	var f bytes.Buffer
	if err := pdf.Output(&f); err != nil {
		return nil, nil, err
	}
	return p.Bytes(), f.Bytes(), nil
}
