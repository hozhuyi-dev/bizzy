// Command copy replaces a test environment's data with another's
// (production's, usually), to try the app on real data. scripts/copy.mjs
// runs it locally, with both environments' settings read from their api
// Lambdas:
//
//	pnpm data:copy production staging
//
// Nothing is written until it is all known to work. It refuses a target
// but development and staging; one whose deployed code isn't this
// checkout's (its schema version is another); one not connected to
// Google, or connected to the source's account. Then:
//
//  1. Takes the source whole as of one moment (see internal/snapshot),
//     raising its capacity for the read as far as its size needs.
//  2. In memory: migrates it with this checkout's migrations, checking
//     every item and invariant, and scrubs whatever could reach a client
//     (see snapshot.Scrub): every phone becomes the business's own
//     (COPY_PHONE overrides it), every email its own tagged (COPY_EMAIL).
//  3. In the target's Google account: makes a calendar for the copy
//     ("bizzy-staging · 24 Oct 2026 15:04"), and replaces the contacts the
//     last copy made (under the label "bizzy-staging") with one per
//     linked client, which the copy is linked to.
//  4. Fences the target, wipes it but for its Google connection (which
//     now names the new calendar), writes the copy, replaces its files
//     (issued PDFs as kept, a placeholder for every attachment), and lowers
//     the fence.
//  5. Publishes the target's payment page, and syncs: bizzy writes every
//     session and follow-up of the last 60 days on into the new calendar,
//     and older months as the app reads back (the backfill).
//  6. Deletes the calendars earlier copies into the target made.
//
// Development and staging may share one Google account, so what a copy
// makes in Google is named for its environment, and only that is deleted.
package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"slices"
	"strings"
	"time"
	_ "time/tzdata"

	"google.golang.org/api/googleapi"

	"bizzy-lambda/internal/app"
	"bizzy-lambda/internal/calendar"
	"bizzy-lambda/internal/features/attachments"
	"bizzy-lambda/internal/features/clients"
	"bizzy-lambda/internal/features/contacts"
	"bizzy-lambda/internal/features/documents"
	"bizzy-lambda/internal/features/googleconnect"
	"bizzy-lambda/internal/features/reset"
	"bizzy-lambda/internal/features/settings"
	"bizzy-lambda/internal/migrations"
	"bizzy-lambda/internal/platform/blobstore"
	"bizzy-lambda/internal/platform/dynamo"
	"bizzy-lambda/internal/platform/googleauth"
	"bizzy-lambda/internal/platform/migrate"
	"bizzy-lambda/internal/platform/table"
	"bizzy-lambda/internal/platform/txn"
	"bizzy-lambda/internal/snapshot"
)

// listedIn bounds the wait for Google to list the contacts just made: the
// sync marks a linked contact it doesn't list missing.
const listedIn = 2 * time.Minute

func main() {
	// Stopped, it still sets the tables' capacity back (restore).
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	err := run(ctx)
	stop()
	if err != nil {
		log.Fatalf("copy: %v", err)
	}
	log.Print("done")
}

func run(ctx context.Context) error {
	env := os.Getenv("ENVIRONMENT")
	if !reset.Allowed(env) {
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
	defer restore()

	// What is refused, before anything is written.
	target, err := txn.ReadSchema(ctx, dst)
	if err != nil {
		return err
	}
	if target.Version != migrations.Version && !target.Migrating {
		return fmt.Errorf("%s is deployed at schema version %d, this checkout at %d: run the copy from the code deployed there", env, target.Version, migrations.Version)
	}
	kept, err := dst.Query(ctx, table.Query{PK: googleconnect.Connections.Name})
	if err != nil {
		return err
	}
	connItem, conn, err := connectionOf(kept)
	if err != nil {
		return fmt.Errorf("%s: connect Google in its Settings first: %w", env, err)
	}

	if err := boost(ctx, src, src, dynamo.Whole{Reads: 1}); err != nil {
		return err
	}
	snap, err := snapshot.Take(ctx, src, srcBlobs)
	if err != nil {
		return err
	}
	if snap.Account != "" && strings.EqualFold(snap.Account, conn.Email) {
		return fmt.Errorf("%s is connected to %s, the source's Google account: connect a test account in its Settings first", env, conn.Email)
	}
	log.Printf("took %d items from %s at schema version %d, and %d issued PDFs", len(snap.Items), src.Name, snap.Schema.Version, len(snap.PDFs))

	// In memory: migrated, checked and scrubbed.
	mem, err := prepare(ctx, snap, loc)
	if err != nil {
		return err
	}

	// In the target's Google account; what fails here leaves the target
	// as it was.
	client, err := google.Client(ctx)
	if err != nil {
		return err
	}
	cal, err := calendar.CreateCalendar(ctx, client, calendarName(env, loc), loc.String())
	if err != nil {
		if insufficientScope(err) {
			return fmt.Errorf("the copy makes a calendar, which %s's Google connection doesn't allow yet: reconnect Google in its Settings (and add %s to the OAuth consent screen's scopes): %w", env, googleauth.ScopeAppCalendars, err)
		}
		return err
	}
	log.Printf("made the calendar %q", cal.Name)
	dir := contacts.NewGoogle(google.Client)
	made, err := replaceContacts(ctx, dir, "bizzy-"+env, mem)
	if err != nil {
		return err
	}

	// The target, fenced while it is written.
	conn.CalendarID, conn.CalendarName = cal.ID, cal.Name
	data, err := json.Marshal(conn)
	if err != nil {
		return err
	}
	if connItem, err = googleconnect.Connections.Rewrite(table.Item{Key: connItem.Key, Data: data}); err != nil {
		return err
	}
	stored, err := mem.Runner.Table.Scan(ctx)
	if err != nil {
		return err
	}
	items := slices.DeleteFunc(stored, func(it table.Item) bool { return slices.Contains(snapshot.Left, it.PK) })
	if err := boost(ctx, dst, src, dynamo.Whole{Reads: 1, Writes: 2}); err != nil {
		return err
	}
	if err := write(ctx, dst, target.Version, append(items, connItem)); err != nil {
		return err
	}
	for _, prefix := range []string{attachments.KeyPrefix, documents.PDFKeyPrefix} {
		if _, err := dstBlobs.DeletePrefix(ctx, prefix); err != nil {
			return err
		}
	}
	placed, err := snap.Files(ctx, items, dstBlobs)
	if err != nil {
		return err
	}
	if err := snapshot.Write(ctx, dst, []table.Item{txn.SchemaItem(txn.Schema{Version: migrations.Version})}); err != nil {
		return fmt.Errorf("lower the fence: %w", err)
	}
	log.Printf("wrote %d items to %s, %d issued PDFs and a placeholder for each of %d attachments", len(items), dst.Name, len(snap.PDFs), placed)

	// The app serves the copy now.
	a := app.New(app.Deps{
		Table: dst, Blobs: dstBlobs, PaySite: paySite, Google: google,
		Location: loc, Now: time.Now, NewID: newID, Parallel: 4,
	})
	cfg, err := txn.Read(ctx, a.Runner, func(tx *txn.Tx) (settings.Settings, error) { return settings.Get(tx) })
	if err != nil {
		return err
	}
	if err := paySite.Publish(ctx, cfg); err != nil {
		return fmt.Errorf("publish the payment page: %w", err)
	}
	if err := waitListed(ctx, dir, made); err != nil {
		return err
	}
	ctx, end := txn.Scoped(ctx) // as a request runs it: the calendar is written after each commit
	_, err = a.Sync.Run(ctx)
	end(ctx)
	if err != nil {
		return fmt.Errorf("sync: %w", err)
	}
	log.Print("synced: the calendar shows the last 60 days on, and older months as the app reads back")
	deleteEarlier(ctx, client, env, cal.ID)
	return nil
}

// prepare is the snapshot in memory, migrated and checked, then scrubbed
// (snapshot.Scrub.Text on every item as this code stores it, then its
// Contacts) and checked again.
func prepare(ctx context.Context, snap snapshot.Snapshot, loc *time.Location) (*app.App, error) {
	a, rep, err := migrated(ctx, snap, loc)
	if err != nil {
		return nil, fmt.Errorf("migrate the copy (nothing was written): %w", err)
	}
	log.Printf("migrated from version %d to %d, %d items rewritten", rep.From, rep.To, rep.Written)
	cfg, err := txn.Read(ctx, a.Runner, func(tx *txn.Tx) (settings.Settings, error) { return settings.Get(tx) })
	if err != nil {
		return nil, err
	}
	scrub, err := snapshot.ScrubOf(cfg, os.Getenv("COPY_PHONE"), os.Getenv("COPY_EMAIL"))
	if err != nil {
		return nil, err
	}
	stored, err := a.Runner.Table.Scan(ctx)
	if err != nil {
		return nil, err
	}
	stored = slices.DeleteFunc(stored, func(it table.Item) bool { return it.PK == txn.SchemaKey.PK })
	scrubbed, counts := scrub.Text(stored)
	if a, _, err = migrated(ctx, snapshot.Snapshot{Items: scrubbed, Schema: txn.Schema{Version: migrations.Version}}, loc); err != nil {
		return nil, fmt.Errorf("check the scrubbed copy (nothing was written): %w", err)
	}
	n, err := scrub.Contacts(ctx, a.Runner.Quiet())
	if err != nil {
		return nil, fmt.Errorf("scrub (nothing was written): %w", err)
	}
	log.Printf("scrubbed: phones are %s, emails %s; %d numbers and addresses found in text %v, %d items' contacts", scrub.Phone, scrub.EmailFor("…"), sum(counts), counts, n)
	return a, nil
}

// migrated is the app on a memory table holding the snapshot, migrated to
// this code's version (and so every item rewritten and checked).
func migrated(ctx context.Context, snap snapshot.Snapshot, loc *time.Location) (*app.App, migrate.Report, error) {
	mem := table.NewMemory()
	if err := snap.Load(ctx, mem); err != nil {
		return nil, migrate.Report{}, err
	}
	a := app.New(app.Deps{Table: mem, Location: loc, Now: time.Now, NewID: newID}) // nothing it serves is called
	rep, err := migrate.Run(ctx, migrate.Options{Runner: a.Runner, Kinds: app.Kinds(), Migrations: migrations.All})
	return a, rep, err
}

// replaceContacts deletes the contacts under label (the last copy's), makes
// one there for every client the copy links to a contact, from its copy of
// it, and links the client to it. It returns them by client id.
func replaceContacts(ctx context.Context, dir *contacts.Google, label string, a *app.App) (map[string]contacts.Person, error) {
	deleted, err := dir.DeleteLabelled(ctx, label)
	if err != nil {
		return nil, err
	}
	linked, err := txn.Read(ctx, a.Runner, clients.Clients.All)
	if err != nil {
		return nil, err
	}
	details := map[string]contacts.Details{}
	for _, c := range linked {
		if k := c.Contact; k != nil {
			street := k.Address
			postcode := k.Postcode
			if strings.Contains(street, postcode) {
				postcode = ""
			}
			details[c.ID] = contacts.Details{
				GivenName: cmpOr(k.DisplayName, c.Name), Email: k.Email, Phone: k.Phone,
				Address: contacts.Address{Street: street, Postcode: postcode},
			}
		}
	}
	made, err := dir.CreateLabelled(ctx, label, details)
	if err != nil {
		return nil, err
	}
	now := time.Now()
	n, err := snapshot.Each(ctx, a.Runner.Quiet(), clients.Clients, func(c *clients.Client) bool {
		p, ok := made[c.ID]
		if ok {
			link := p.Link(now)
			c.Contact = &link
		}
		return ok
	})
	if err != nil {
		return nil, fmt.Errorf("link the contacts: %w", err)
	}
	if n != len(details) {
		return nil, fmt.Errorf("made contacts for %d of %d clients", n, len(details))
	}
	log.Printf("deleted the %d contacts under %q, and made %d", deleted, label, n)
	return made, nil
}

// waitListed waits until Google lists every contact made, which can take
// a moment after making them.
func waitListed(ctx context.Context, dir *contacts.Google, made map[string]contacts.Person) error {
	deadline := time.Now().Add(listedIn)
	for {
		listed, err := dir.List(ctx)
		if err != nil {
			return err
		}
		missing := len(made)
		for _, p := range listed {
			for _, m := range made {
				if m.ResourceName == p.ResourceName {
					missing--
				}
			}
		}
		if missing <= 0 {
			return nil
		}
		if time.Now().After(deadline) {
			log.Printf("Google doesn't list %d of the contacts made yet: the sync marks them missing until it does", missing)
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(5 * time.Second):
		}
	}
}

// write fences the target at its version, wipes it but for its Google
// connection, and writes the items, their index keys and all. The fence
// stays up: lowered once the files are in.
func write(ctx context.Context, dst *dynamo.Table, version int, items []table.Item) error {
	fence := txn.SchemaItem(txn.Schema{Version: version, Migrating: true})
	if err := snapshot.Write(ctx, dst, []table.Item{fence}); err != nil {
		return fmt.Errorf("raise the fence: %w", err)
	}
	if _, err := dst.Wipe(ctx, txn.Commits, googleconnect.Connections.Name, txn.SchemaKey.PK); err != nil {
		return err
	}
	// A warm Lambda drops what it read of the target before.
	return snapshot.Write(ctx, dst, items)
}

// connectionOf is the Google connection, the one item of its partition, as
// stored and read.
func connectionOf(partition []table.Item) (table.Item, googleconnect.Connection, error) {
	var c googleconnect.Connection
	if len(partition) != 1 {
		return table.Item{}, c, errors.New("not connected")
	}
	if err := json.Unmarshal(partition[0].Data, &c); err != nil {
		return partition[0], c, err
	}
	if c.Email == "" {
		return partition[0], c, errors.New("not connected")
	}
	return partition[0], c, nil
}

// calendarPrefix starts the name of every calendar a copy into env makes.
func calendarPrefix(env string) string { return "bizzy-" + env + " · " }

func calendarName(env string, loc *time.Location) string {
	return calendarPrefix(env) + time.Now().In(loc).Format("2 Jan 2006 15:04")
}

// deleteEarlier deletes the calendars earlier copies into env made, but
// keep. A failure only leaves one behind, to delete by hand.
func deleteEarlier(ctx context.Context, client *http.Client, env, keep string) {
	all, err := calendar.Calendars(ctx, client)
	if err != nil {
		log.Printf("list the calendars, to delete earlier copies': %v", err)
		return
	}
	for _, c := range all {
		if c.ID == keep || !strings.HasPrefix(c.Name, calendarPrefix(env)) {
			continue
		}
		if err := calendar.DeleteCalendar(ctx, client, c.ID); err != nil {
			log.Printf("delete the calendar %q (delete it by hand): %v", c.Name, err)
			continue
		}
		log.Printf("deleted the calendar %q", c.Name)
	}
}

// insufficientScope reports whether Google refused a call for want of a
// scope the grant doesn't have.
func insufficientScope(err error) bool {
	var gerr *googleapi.Error
	return errors.As(err, &gerr) && gerr.Code == http.StatusForbidden &&
		(strings.Contains(strings.ToLower(gerr.Message), "scope") || strings.Contains(strings.ToLower(gerr.Body), "insufficient"))
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

func sum(counts map[string]int) int {
	n := 0
	for _, c := range counts {
		n += c
	}
	return n
}

func cmpOr(a, b string) string {
	if a != "" {
		return a
	}
	return b
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
