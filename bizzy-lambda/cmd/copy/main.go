// Command copy replaces a test environment's data with another's
// (production's, usually), to try the app on real data. scripts/copy.mjs
// runs it locally, with both environments' settings read from their api
// Lambdas:
//
//	pnpm data:copy production staging
//
// It refuses any target but development and staging, or a target whose
// chosen calendar is the source's, then:
//
//  1. Raises both tables' capacity for the run as far as their size needs,
//     setting it back after.
//  2. Fences the target (the app says it is being updated), wipes it but
//     for its Google connection, and copies every item but what ties the
//     source to its own calendar: the sync's state, event links and
//     conflicts.
//  3. Replaces the target's files: issued PDFs copied as they are (their
//     hash is kept with them), every attachment a small placeholder.
//  4. Runs this checkout's migrations on the target, which lowers the
//     fence: run it from the code deployed there.
//  5. Publishes the target's payment page from the copied settings.
//  6. If the target has a calendar chosen, deletes every event in it and
//     syncs: bizzy writes every copied session and follow-up there.
package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	"log"
	"os"
	"slices"
	"time"
	_ "time/tzdata"

	"codeberg.org/go-pdf/fpdf"

	"bizzy-lambda/internal/app"
	"bizzy-lambda/internal/features/attachments"
	"bizzy-lambda/internal/features/conflicts"
	"bizzy-lambda/internal/features/documents"
	"bizzy-lambda/internal/features/googleconnect"
	"bizzy-lambda/internal/features/googlesync"
	"bizzy-lambda/internal/features/reset"
	"bizzy-lambda/internal/features/settings"
	"bizzy-lambda/internal/migrations"
	"bizzy-lambda/internal/platform/blobstore"
	"bizzy-lambda/internal/platform/dynamo"
	"bizzy-lambda/internal/platform/googleauth"
	"bizzy-lambda/internal/platform/migrate"
	"bizzy-lambda/internal/platform/table"
	"bizzy-lambda/internal/platform/txn"
)

// left are the partitions not copied: the target keeps its own Google
// connection, starts the sync over on its own calendar, and is migrated
// from the source's schema (written as the fence).
var left = []string{
	googleconnect.Connections.Name, googlesync.States.Name, googlesync.Links.Name,
	conflicts.Conflicts.Name, txn.SchemaKey.PK,
}

// maxBackfills bounds the months the sync reads back.
const maxBackfills = 600

func main() {
	if err := run(context.Background()); err != nil {
		log.Fatalf("copy: %v", err)
	}
	log.Print("done")
}

func run(ctx context.Context) error {
	if env := os.Getenv("ENVIRONMENT"); !reset.Allowed(env) {
		return fmt.Errorf("only development or staging can be copied into, not %q", env)
	}
	dst, err := dynamo.New(ctx)
	if err != nil {
		return err
	}
	src := &dynamo.Table{Client: dst.Client, Name: mustEnv("FROM_TABLE_NAME")}
	if src.Name == dst.Name {
		return fmt.Errorf("%s is both the source and the target", src.Name)
	}
	loc, err := time.LoadLocation(mustEnv("TIME_ZONE"))
	if err != nil {
		return fmt.Errorf("TIME_ZONE: %w", err)
	}
	srcBlobs, err := blobstore.NewS3(ctx, mustEnv("FROM_BUCKET_NAME"))
	if err != nil {
		return err
	}
	dstBlobs, err := blobstore.NewS3(ctx, mustEnv("BUCKET_NAME"))
	if err != nil {
		return err
	}
	payStore, err := blobstore.NewS3(ctx, mustEnv("PAY_BUCKET_NAME"))
	if err != nil {
		return err
	}
	payStore.CacheControl = "public, max-age=60" // as cmd/api has it
	paySite := settings.PaySite{Store: payStore, URL: mustEnv("PAY_URL")}
	google := googleauth.New(mustEnv("GOOGLE_CLIENT_ID"), mustEnv("GOOGLE_CLIENT_SECRET"), googleauth.ParamTokens(mustEnv("GOOGLE_TOKEN_PARAM")))
	a := app.New(app.Deps{
		Table: dst, Blobs: dstBlobs, PaySite: paySite, Google: google,
		Location: loc, Now: time.Now, NewID: newID, Parallel: 4,
	})

	// The source is read once; the target gets its items, which the
	// migration then reads, writes again and checks.
	defer restore()
	if err := boost(ctx, src, src, dynamo.Whole{Reads: 1}); err != nil {
		return err
	}
	if err := boost(ctx, dst, src, dynamo.Whole{Reads: 3, Writes: 2}); err != nil {
		return err
	}

	all, err := src.Scan(ctx)
	if err != nil {
		return err
	}
	kept, err := dst.Query(ctx, table.Query{PK: googleconnect.Connections.Name})
	if err != nil {
		return err
	}
	calendarID := calendarOf(kept)
	if calendarID != "" && calendarID == calendarOf(all) {
		return fmt.Errorf("the target's calendar is the source's, which the copy would empty: choose another in the target's Settings first")
	}

	items, err := copyTable(ctx, src, dst, all)
	if err != nil {
		return err
	}
	if err := copyFiles(ctx, srcBlobs, dstBlobs, items); err != nil {
		return err
	}
	rep, err := migrate.Run(ctx, migrate.Options{Runner: a.Runner, Kinds: app.Kinds(), Migrations: migrations.All})
	if err != nil {
		return fmt.Errorf("migrate the copy (the app says it is being updated until this is fixed): %w", err)
	}
	log.Printf("migrated from version %d to %d, %d items rewritten", rep.From, rep.To, rep.Written)

	cfg, err := txn.Read(ctx, a.Runner, func(tx *txn.Tx) (settings.Settings, error) { return settings.Get(tx) })
	if err != nil {
		return err
	}
	if err := paySite.Publish(ctx, cfg); err != nil {
		return fmt.Errorf("publish the payment page: %w", err)
	}

	if calendarID == "" {
		log.Print("the target has no calendar chosen: choose an empty one in Settings, and bizzy writes every session there")
		return nil
	}
	return refillCalendar(ctx, a, google)
}

// copyTable fences the target, wipes it but for its Google connection, and
// writes the source's items into it, their index keys and all. It returns
// the items written.
func copyTable(ctx context.Context, src, dst *dynamo.Table, all []table.Item) ([]table.Item, error) {
	schema, err := txn.ReadSchema(ctx, src)
	if err != nil {
		return nil, err
	}
	fence := txn.SchemaItem(txn.Schema{Version: schema.Version, Migrating: true})
	if err := commit(ctx, dst, []table.Write{{Put: &fence}}); err != nil {
		return nil, fmt.Errorf("raise the fence: %w", err)
	}
	if _, err := dst.Wipe(ctx, txn.Commits, googleconnect.Connections.Name, txn.SchemaKey.PK); err != nil {
		return nil, err
	}
	var items []table.Item
	for _, it := range all {
		if !slices.Contains(left, it.PK) {
			items = append(items, it)
		}
	}
	// Through commits, so every partition's version moves on: a warm
	// Lambda drops what it read of the target before.
	for batch := range slices.Chunk(items, table.MaxWrites) {
		writes := make([]table.Write, len(batch))
		for i := range batch {
			writes[i] = table.Write{Put: &batch[i]}
		}
		if err := commit(ctx, dst, writes); err != nil {
			return nil, err
		}
	}
	log.Printf("copied %d items from %s, at schema version %d", len(items), src.Name, schema.Version)
	return items, nil
}

// commit writes a batch as the only writer: the fence keeps the app out.
func commit(ctx context.Context, tb table.Table, writes []table.Write) error {
	read, err := tb.Versions(ctx, txn.Commits)
	if err != nil {
		return err
	}
	for _, w := range writes {
		read[w.PK()] = read[w.PK()]
	}
	_, err = tb.Commit(ctx, txn.Commits, read, writes)
	return err
}

// copyFiles replaces the target's files: the issued PDFs as they are, and
// a placeholder for every attachment and its thumbnail.
func copyFiles(ctx context.Context, src, dst blobstore.Store, items []table.Item) error {
	for _, prefix := range []string{attachments.KeyPrefix, documents.PDFKeyPrefix} {
		if _, err := dst.DeletePrefix(ctx, prefix); err != nil {
			return err
		}
	}
	pdfs, err := src.List(ctx, documents.PDFKeyPrefix)
	if err != nil {
		return err
	}
	for _, f := range pdfs {
		body, err := src.Get(ctx, f.Key)
		if err != nil {
			return err
		}
		if err := dst.Put(ctx, f.Key, "application/pdf", body); err != nil {
			return err
		}
	}
	photo, file, err := placeholders()
	if err != nil {
		return err
	}
	n := 0
	for _, it := range items {
		if it.PK != attachments.Attachments.Name {
			continue
		}
		var at attachments.Attachment
		if err := json.Unmarshal(it.Data, &at); err != nil {
			return fmt.Errorf("attachment %s: %w", it.SK, err)
		}
		body := photo
		if at.ContentType == "application/pdf" {
			body = file
		}
		if err := dst.Put(ctx, at.Key, at.ContentType, body); err != nil {
			return err
		}
		if at.ThumbnailKey != "" {
			if err := dst.Put(ctx, at.ThumbnailKey, "image/jpeg", photo); err != nil {
				return err
			}
		}
		n++
	}
	log.Printf("copied %d issued PDFs, and put a placeholder for each of %d attachments", len(pdfs), n)
	return nil
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

// refillCalendar deletes every event in the target's calendar, then syncs,
// which writes every session and follow-up there, a month at a time back.
func refillCalendar(ctx context.Context, a *app.App, google *googleauth.Auth) error {
	cal, err := googleconnect.Calendar(a.Runner, google)(ctx)
	if err != nil {
		return fmt.Errorf("open the target's calendar: %w", err)
	}
	events, err := cal.Changed(ctx, time.Time{}, time.Time{}, time.Time{})
	if err != nil {
		return err
	}
	for i, e := range events {
		if err := cal.Delete(ctx, e.ID, e.ETag); err != nil {
			return fmt.Errorf("delete event %s: %w", e.ID, err)
		}
		if (i+1)%50 == 0 {
			log.Printf("deleted %d of %d events", i+1, len(events))
		}
	}
	log.Printf("deleted the %d events in the target's calendar", len(events))

	// As a request runs it, so the writes to the calendar after each
	// commit are made.
	sync := func(do func(context.Context) (googlesync.Run, error)) (googlesync.Run, error) {
		ctx, end := txn.Scoped(ctx)
		run, err := do(ctx)
		end(ctx)
		return run, err
	}
	run, err := sync(a.Sync.Run)
	if err != nil {
		return fmt.Errorf("sync: %w", err)
	}
	for i := 0; !run.Back.IsZero() && i < maxBackfills; i++ {
		if run, err = sync(a.Sync.Backfill); err != nil {
			return fmt.Errorf("backfill: %w", err)
		}
	}
	log.Print("synced: the calendar shows every session and follow-up")
	return nil
}

// calendarOf is the calendar chosen in the Google connection among items,
// "" for none.
func calendarOf(items []table.Item) string {
	for _, it := range items {
		if it.PK != googleconnect.Connections.Name {
			continue
		}
		var c googleconnect.Connection
		if json.Unmarshal(it.Data, &c) == nil {
			return c.CalendarID
		}
	}
	return ""
}

// restores set the boosted tables back.
var restores []func(context.Context) error

// boost raises a table's capacity for a run over every item of sized.
func boost(ctx context.Context, tb, sized *dynamo.Table, w dynamo.Whole) error {
	need, err := sized.Need(ctx, w)
	if err != nil {
		return err
	}
	r, err := tb.Boost(ctx, need)
	restores = append(restores, r)
	return err
}

func restore() {
	for _, r := range restores {
		if err := r(context.Background()); err != nil {
			log.Printf("copy: %v: set it back by hand", err)
		}
	}
}

// newID is a random 16-character hex id, as cmd/api makes them.
func newID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func mustEnv(name string) string {
	v := os.Getenv(name)
	if v == "" {
		log.Fatalf("copy: %s is not set", name)
	}
	return v
}
