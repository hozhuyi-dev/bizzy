# bizzy

Back-office for a one-person physio practice: sessions, packages, invoices and receipts, follow-ups, expenses. Sessions are booked in Google Calendar or in the app.

## Design principles

1. **bizzy is the truth; Google Calendar is a command surface.** A calendar edit is read as the command the app would send, under the same rules. Every event in the chosen calendar is bizzy's (a session, a follow-up `!`) or refused. A refused edit waits on the to-do list with remedies, one of which always puts bizzy's version back. Google Contacts is the truth for contact details (the app keeps a read-only copy); a client's IC or passport number is bizzy's.
2. **Documents own money.** A fee is its invoice line, a payment its receipt line. Drafts are made with every booking and payment and stay editable until issued. An issued document changes only by non-legal corrections (a new revision) or by cancelling.
3. **An issued document is printed once.** Issuing renders the PDF in the API and commits its SHA-256 with the revision; the file is then kept in S3 (locked for 7 years in production) and served as kept, stamped CANCELLED once cancelled. A lost file is re-rendered only if it matches the hash. So the layout can change freely: only new documents look new. Drafts render fresh, watermarked DRAFT.
4. **The app never reaches an invalid state.** Every change is an action that checks its rules before anything is written. A refusal changes nothing and offers remedies. Invariants are checked again before every commit.
5. **Delete undoes a mistake; history stays.** An item with history (it happened, something was recorded, money or an issued document covers it) is cancelled or archived instead (see [Lifecycle](#lifecycle)), and stays readable.
6. **No business rule in the web app.** Every view carries `can` (a verdict per action: ok, or why not plus remedies) and `locked` (fields its update can't change now). The web shows and disables by them, never by reading state. PDFs come from the API too.
7. **Every rule is tested by use.** A property-based simulation drives every action, the calendar and the clock in random order, checking every invariant after every step.
8. **Reads are the budget; Google is the wait.** The table is small and provisioned, and every consistent read costs a unit however small the item, so reads add up per call, not per byte. A request reads the versions item and what changed since; a response says what it changed, and the web reads again only what shows that; a page is one call. A call to Google takes hundreds of milliseconds: none is made twice in a request, and those that don't wait on each other run at once.

Conventions: identifiers say "user", never "her". Until production holds data, a change to how items are stored is a reset, not a migration: delete `bizzy-lambda/SCHEMA.md`, regenerate it, deploy and **Settings → Reset** (development and staging only). After that, every such change is a [migration](#migrations).

## Tech stack

| Folder | What | Stack |
| --- | --- | --- |
| `bizzy-web` | The app (SPA) | React 19, Vite, TanStack Router / Query / Form / Table, Tailwind, shadcn/ui, Amplify auth, Vitest |
| `bizzy-lambda` | API, calendar/contacts sync, PDFs, jobs | Go, DynamoDB (single table), S3, fpdf, `pgregory.net/rapid` |
| `bizzy-infra` | AWS resources | CDK (TypeScript) |

Sign-in is Google via Cognito. Only `ALLOWED_EMAIL` gets identity-pool credentials, which the browser uses to invoke the API Lambda directly (no API Gateway). Calendar and Contacts use a separate OAuth consent (**Settings → Connect Google**); the refresh token is in SSM.

## Code layout

```
bizzy-infra/    bin/bizzy-infra.ts → lib/{auth,data,api,web}-stack.ts, constructs in lib/common/
bizzy-lambda/   cmd/{api,public,job-quarterly,migrate}/main.go, internal/{app,features,migrations,platform,calendar,simulation,testutil}/
bizzy-web/      src/main.tsx, src/routes/ (file routes), src/features/<feature>/
scripts/        web-env.mjs: writes bizzy-web/.env.<env> from stack outputs
```

### bizzy-infra

[bin/bizzy-infra.ts](bizzy-infra/bin/bizzy-infra.ts) reads `.env.<ENVIRONMENT>` and creates `<project>-<env>-{auth,data,api,web}`:

- **auth**: Cognito user pool (Google IdP) and identity pool, mapped to `ALLOWED_EMAIL`.
- **data**: the DynamoDB table (5 generic LSIs, created up front) and the file bucket: `attachments/` and issued PDFs under `documents/`. Production versions it (35-day noncurrent expiry) and has Object Lock on. Also the payment page's site, in every environment: its own bucket (no versions; Settings rewrites it) behind CloudFront.
- **api**: the `api`, `public` (share links: a Function URL that can only `GetItem` and read issued PDFs), `job-quarterly` (EventBridge) and `migrate` (run by deploys) Go Lambdas.
- **web** (staging and production): S3 and CloudFront for the SPA. A deploy drops the previous build's files, and the bucket keeps no versions, so no old build is kept. Each deploy also deletes the Lambda builds no stack uses from the CDK assets bucket (`cdk gc`).

### bizzy-lambda

[cmd/api](bizzy-lambda/cmd/api/main.go) builds [internal/app](bizzy-lambda/internal/app/app.go), which wires one `txn.Runner`, the calendar sync and every feature's routes. The router dispatches `{action, payload}` to a `Query` or a `Mutation`.

**Every change is an action run by `txn.Run`**, whether from the app or the calendar:

```mermaid
flowchart TD
  app["App request"] --> handler["feature route"]
  cal["Calendar event"] --> tr["googlesync.FromCalendar<br/>(syntax only)"]
  handler --> action["action(tx)"]
  tr --> action
  subgraph run["txn.Run"]
    direction TB
    action --> later["Later checks"] --> inv["Invariants on<br/>what changed"] --> commit["Commit<br/>(one transaction)"]
  end
  commit --> after["After: write the calendar,<br/>store an issued PDF"]
  action -- "refused" --> err["Error + remedies<br/>(nothing written)"]
  later -- "refused" --> err
  err -- "from the calendar" --> conflict["conflict on the to-do list"]
```

- **Actions** are plain functions of a `txn.Tx` (`sessions.Update(tx, id, fields)`); nothing is written until they return. `Fields` is a patch, applied in steps that each check their rules and refuse with `apperr.Refused(message, remedies…)`. Rules across items (overlap) use `tx.Later`, so changes made together are judged together.
- **Invariants** (`<feature>/invariants.go`) are checked on every item a commit changes. One that breaks is a bug: an internal error, nothing written.
- **Commits are checked by partition**: one item holds every partition's version; a commit goes through only if nothing it read or writes moved since it began, else the action reruns on fresh data.
- **Reads are kept** ([txn/cache.go](bizzy-lambda/internal/platform/txn/cache.go)): what a warm Lambda read stays in memory while its partition's version holds, and its own commits update it, so most runs read only the versions item. A kind of few, much-read items is `Whole`: read whole once, every read answered from it. A query that stops at a `Limit` reads only that many.
- **A request is one `txn.Scope`**: the kinds its commits changed go back as `changed`, and work after commits waits for its end, done once. The Lambda logs a `request` line for each: action, ms, and its table reads, commits and Google calls.
- **The calendar is an adapter.** `googlesync` keeps a `Link` per event (its session, and what both said when last agreed). A changed event becomes `sessions.Create`/`Update` with only what the user changed, one commit per event; a deleted one deletes its session, or cancels it when it has history. Refused events retry after the others (together, for a swap), then wait as conflicts. Changed sessions are written to their events at the end of the request, `Parallel` calls at a time and recorded in one commit, over each event as the request last saw it (Google refuses a write over a newer one); the next sync finishes a failed write, writing only events that differ. A calendar is read 60 days back, then backfilled a month per `sync.backfill`. Choosing another calendar keeps bizzy's data, writes every item into the new one and leaves the old one untouched.
- **PDFs** are laid out by `platform/pdflayout`, a small QuestPDF-style layer over fpdf: blocks (`Text`, `Row`, `Column`, `Flow`, `Table`, …) measure their height and draw themselves, and pages break between blocks only (a table between rows, its header repeated). Output is byte-for-byte repeatable, which the hash relies on. [documents/render.go](bizzy-lambda/internal/features/documents/render.go) is the layout; `pdf.go` keeps and serves the files (`documents.pdf`, `documents.preview`, the share link).
- **The payment page** ([settings/paypage.go](bizzy-lambda/internal/features/settings/paypage.go)) is static files on its own site: every Settings save renders the page (DuitNow QR, bank details, the phone e-wallets pay), the QR drawn again from what it says, and the preview WhatsApp shows, and writes them after the commit. A failed write fails the save's reply, so saving again mends it. Opening the page costs no Lambda call and no read. It shows only what every payment message already sends, so its address is fixed. Its robots.txt lets in only link-preview bots (WhatsApp, Facebook, Telegram), so the link shows a card but isn't indexed. The message links it as `{payLink}`, with a `{ref}`: the invoice number, or the client's first name and the day (`AISYAH 05OCT`).
- **WhatsApp messages** ([documents/ask.go](bizzy-lambda/internal/features/documents/ask.go)) have two intents. *Ask to pay* (`documents.ask`) turns items (a session's `sources`, a package) and invoices into what is owed: an item on an issued invoice as that invoice, with its link; one on a draft as its own line. *Send for records* (`documents.records`) is the issued documents covering items, sent only when a client asks. Views say both as `askToPay` and `sendRecords`; the web fills in the user's templates (the app's wording while blank).

**Names** are the same in every feature. Outside a package you read `sessions.View`; the web writes `SessionView`.

| Role | Name | ASP.NET Core equivalent |
| --- | --- | --- |
| Stored entity | `Session` | Entity |
| Its storage | `Sessions` (a `txn.Kind`) | `DbSet<T>` / repository |
| What an action changes | `Fields` (a patch) | Command model |
| Actions | `Create`, `Update`, `Delete`, … | Application service / handler |
| Route input | `createRequest`, `idRequest`, … (private to `api.go`) | `XxxRequest` |
| Route output | `View` (never the stored entity) | Response DTO / view model |
| Routes | `Routes(r, run)` | Controller |
| Whether an action would be taken | `Can<Action>(tx, item) error` → the view's `Can` | Policy / authorization handler |
| Fields an update can't change now | `Locks(tx, item)` → the edit view's `Locked` | Read-only field metadata |
| Rules that always hold | `Invariants` | Domain invariants |
| Wiring | `app.New` | DI container / `Program.cs` |

**Layout:**

- `internal/features/<feature>/`: `api.go` (routes, views, requests, `Locks`), the entity file (model, `txn.Kind`, to-do), `actions.go` (actions and their `Can…`), `invariants.go`, and a file per other job (`translate.go`, `render.go`). Features import only what they build on; `app` passes in the reverse (`clients.Owner`). [app/dependencies_test.go](bizzy-lambda/internal/app/dependencies_test.go) enforces it.
- `internal/platform/`: `router`, `apperr`, `txn`, `table` (storage interface, in-memory version, shared contract), `listing`, `migrate`, `dynamo`, `blobstore` (S3), `pdflayout`, `googleauth`, `ssm`. Imports no feature.
- **Long lists are searched, not loaded**: one `<feature>.search` per kind takes a `listing.Request` (words, days, the page to start after) and optional filters, narrows the read with the most selective index they allow (`txn.List`: a client's, a tag's, the open ones, else by time), filters the rest in Go (not DynamoDB filter expressions, which bill every item read and can't see what a view works out), and returns a `listing.Page`, ending when full or after `listing.Budget` items.
- **A list across kinds** (`timeline.search`) pages one kind (a client's sessions) and takes the others within the time each page spans; its cursor carries both. What is coming comes whole with the first page.
- **A page is one call.** Parts from features that can't import each other are composed by `app` in one read (`app.status`, `sessions.page`, `insights.year`); a feature exports the function (`sessions.Full`), not only the route.
- `internal/calendar`: Google Calendar events, title syntax and client, knowing no feature.
- `internal/testutil`: `testapp` (the whole app on the memory table, with fake Calendar, Contacts and S3).
- `internal/simulation`: a rapid state machine over `testapp`, one action per mutation (enforced) plus calendar edits and clock moves. After each step it checks every invariant, that a refusal changed nothing, that each view's `can` matches the API, that every issued PDF is kept as issued, and that once synced the calendar shows bizzy.
- **Refusals are written once**, as a read-only `Can<Action>(tx, item) error` the action calls first. Each view has a `Can` struct (`apperr.VerdictOf`) and, for an update with rules, `Locked` (`apperr.LocksOf`, keyed by JSON path). The simulation calls each mutation as its view said (`callAsViewed`, `callAsLocked`); the action's refusal stays the last word.
- **Storage**: one partition per kind (`PK` = `SESSION`, `SK` = id), the item's JSON in `data`, five LSIs (time, client, open, tag, ref) filled through `txn.Meta`. [SCHEMA.md](bizzy-lambda/SCHEMA.md) is generated from the code; a test fails when it is stale.
- **A new feature** adds those four files, three lines in `app/app.go` (routes, invariants, kinds), a row in `dependencies_test.go`, a `Doc` per kind, a `Can…` per action in its view, a place in [Lifecycle](#lifecycle), a simulation action per mutation, a row per kind in the web's `CHANGED_KEYS`, and a loader (`pageData`) on its page's route.

#### Lifecycle

**Delete** is for a mistake, refused once the item has history. After that it is **Cancelled** (void, kept as it was) or **Archived** (put away, undone by unarchiving). Both stay readable, behind a list chip.

| Entity | Delete while | Then |
| --- | --- | --- |
| Session | not happened (or tentative), nothing recorded, no payment, no issued invoice | **Cancel**: keeps its record, holds no time, costs nothing (credits freed, fee line dropped, a package bought in it kept), leaves the calendar |
| Client | nothing of theirs | **Archive**: out of lists and pickers, nothing new booked until unarchived |
| Package | no credits used, no payment, no issued invoice | Stays; the list hides it once used up and paid |
| Document | a draft never issued (discard) | **Cancel**: number stays used, PDF stamped CANCELLED, lines go back to a draft |

#### Migrations

The table's SQL-style migrations. The code serves only a table at its own version (`migrations.Version`, in the `SCHEMA` item), so it reads items in the shape it writes them.

- **Every change to a stored type or a `Meta`** needs one (once production holds data; see Conventions). `TestSchema` refuses to `-update` SCHEMA.md without one. One with no `Up` is enough when no item needs changing by hand: every run rewrites every item as the code writes it.
- **Writing one**: `internal/migrations/NNN_<what>.go`, appended to `All` (never reorder or change a deployed one). It works on stored JSON (`migrate.EachItem`), never a feature's types, imports only `platform`, changes nothing when run twice, and has `testdata/NNN/{before,after}.json`.
- **Deploying**: CI dry-runs the migrations on an in-memory copy, deploys, then invokes `cmd/migrate`: back up (production; backups older than 35 days are deleted, point-in-time recovery covers them), raise the fence (requests get `unavailable`), migrate, decode every item strictly, rewrite them, check every invariant, lower the fence. A failure leaves the fence up until a fixed migration runs.

### bizzy-web

[src/main.tsx](bizzy-web/src/main.tsx) → `router.tsx` → `src/routes/` (file routes that only read params and render a page). The API is called through `invoke(action, payload)` in `core/lambda/lambda.client.ts`.

- `src/features/<feature>/` files are `<kebab-name>.<layer>.ts(x)`, one dot before the layer. The feature's main file is `<feature>.<layer>` (`sessions.form.ts`); a topic of its own is `<entity>-<topic>.<layer>`, the entity singular (`session-stage.util.ts`, `package-save.hook.ts`). Layers in dependency order: `types`, `constant`, `config`, `util`, `form`, `service`, `query` / `mutation`, `hook`, `list` (what an entity's page steps through), `columns`, `component`.
- Pages are `x-page.component.tsx` at the feature root; other components live in `components/<name>/`. Components reach data only through `query`, `mutation` and `hook`, never a `service`.
- A feature's `types` mirror its `api.go`: output is `<Entity>View`, what a create or update sets is `<Entity>Fields` (an update sends only what changed), other input `<Action><Entity>Request`.
- `core/` is shared infrastructure (`lambda`, `list`, `navigation`, `scroll-spy`, `utils`), `components/shared/` the app's shared components by role (`actions`, `dialog`, `feedback`, `form`, `layout`, `link`, `list`, each a folder per component, named for its main export, which its others share as a prefix: `timeline/` holds `Timeline`, `TimelineItem`, …; the role ends the name: `UnsavedChangesDialog`, `EmptyState`, `DataList` beside `DataTable`), `components/ui/` the generated shadcn components (left untouched). Neither `core` nor `components/shared` imports a feature; ESLint enforces both rules.
- **Every editing surface is a TanStack form** made with `useAppForm` (`components/shared/form`): its fields are the kit's (`<form.AppField name="fee">{(field) => <field.TextField label="Fee" />}</form.AppField>`), its checks the shared ones in `core/utils/form.util` (`requiredError`, `moneyError`, …), checking only what the field shows; the API has the last word. An error shows once a field is left or a submit tried; submit stays enabled (only off while saving), and a submit that doesn't pass takes the cursor to the first error. Refusals are shown with `toastRefusal`, so their remedies come too.
- **A call's `changed` decides what is read again.** `invoke` hands it to `refreshChanged`, which invalidates the queries `CHANGED_KEYS` maps each kind to; mutations invalidate nothing themselves but what the API can't see (Google contacts). A call whose page would restart its forms runs in `keeping(key, …)` and updates that page from its result. Queries stay fresh for minutes, and what only the app changes (the expense catalogue) until a call says it changed; coming back to the app after a while syncs. A page's parts `select` from its one query.
- **Waiting and failing look the same everywhere, and nothing jumps.** An entity page's route (and Home's) reads its data in a loader (`pageData`), so the page being left stays up until the next is ready, with a stripe under the nav or the pager's button spinning. A part shows once every query it draws from has data (`allOf`: sessions with their clients' names), so nothing fills in after. Until then it shows `LoadingState`, but only after `--wait-delay`. Loading, empty and not-found states pair a quip with the line drawing it names (honey: the jar), or one at random (`BeeArt`). The drawings are neutral, like the rest of the UI, except an error's, in red; honey is only for the logo. A page's body loads centred like `NotFoundPage`; anything smaller loads as one line shaped like its empty state (`EmptyStateFrame`), so content grows into place. If a read fails, `ErrorState` takes the same place: a drawing of something broken (a bee adrift when offline), Try again, Copy details for the developer, and a `not_found` reads as `NotFoundPage` with the way back. A failed refresh never replaces what is already shown. A table takes its query as `source` and does both in its body, under its header. Once it already shows rows (cached, or the last filter's), it shows the nav's stripe along its top instead. `ErrorMessage` is only for a form's refused save. Only errors that may pass later are retried. In development, `.env.development.local` can slow calls (`VITE_SLOW_ACTIONS`, `VITE_SLOW_MS`) or fail them (`VITE_FAIL_ACTIONS`).
- **`can` and `locked` in the web** (principle 6): an `Action`'s `can` disables it and says why (a tooltip, or a line in the ⋯ menu); forms disable what `locked` names, with a `LockedHint` under the field. Status is only shown (badges).
- **Every action is an `Action`**, laid out by an `ActionBar` (or `RowActions`, a `Banner`), so its `can` works the same everywhere. A crowded bar folds all but its main action behind ⋯ below `lg` (`foldBelow`). A section with state of its own (ticked rows) is a hook returning its `PageSection`. Where one goes:
  - **By what it acts on, in one place only**: the whole item in the page header, one section (or session step) beside its heading, one row on the row. Buttons inside content only for one field or line (remove a line, an `InlineField`).
  - **The header**: `actions` is the page's one main job, primary and always shown (New X, Book session, Issue, Save while changed); `moreActions` the frequent ones; `menuActions` the rare and lifecycle ones (Revise, Archive, Cancel, Delete), destructive last. Lifecycle actions are only ever behind ⋯ (a list's row ⋯ too).
  - **A question the item waits on** (not confirmed, a calendar conflict) is a page `Banner` with its answers.
  - **Several ways to do one thing** are one `menu` action (a group behind ⋯). **WhatsApp ▾** on a session, package or document, and on one client's ticked documents, holds Ask to pay, Send for records and Open chat, each by its `can`.
  - **Labels**: "New X" makes a standalone X, "Add X" attaches one to this page's item; verb and noun in a header ("Delete session"), the verb alone in a row. A row with one action (not a lifecycle one) shows it, not a ⋯.
- What is left to set up shows as one banner on every page (`SetupNotice`, given to every `PageHeader` by the root through `AppBannerContext`): Google to connect, reconnect or choose a calendar for, and the business details the API says are missing (`settings.gaps`): name, SSM number, phone, email and bank details, which invoices, receipts and the WhatsApp payment message use; the address is optional.
- **One list per kind, narrowed by filters, never split into pages** (follow-ups by status, documents by type; Reconnect is a client filter), so any filter combines with any other. Its `FilterBar` holds words, facet chips and **presets**: named filters picked from a button (Overdue, Unpaid invoices), the first the list's default. All are kept in the URL (`filterUrl` leaves defaults out). Endless lists (sessions, documents, follow-ups, expenses) use `search` and `usePages` in the API's order; lists loaded whole (clients, packages) filter and sort in the browser (`sort` in the URL), so Back and an item's pager keep the order. Bulk actions on documents show once the list is one client's, as each is one chat or one document.
- **A row opens as a whole**: a click, or Enter on it (`useOpenRow`). Nothing in it links to the same place, and no Edit button repeats a row that opens its editor. Its buttons are only what is left to do, the same wherever it is listed: the to-do list, a table, a timeline (`SessionQuickActions`, `FollowUpDoneButton`, `PaidMenu`, `IssueButton`).
- **Section lists mark the one being read alike**: a page's contents and a session's steps are underlined on a phone, on a left rail wider.
- **Design tokens are in `styles/app.css` only**: colours by meaning (status tones, brand, chart series, light and dark), the page's frame in rem (`--nav-height`, `--page-header-height`, `--page-gutter`, `--content-width`, `--row-height`, `--touch-target`, …), the layers (`--z-*`) and the type roles (`type-page-title`, `type-section-title`). Components use them (`h-(--page-header-height)`), never a raw colour or a size another component also knows, and the scroll measuring reads them, so changing one changes the app, and the root font size scales it all.
- **Documents are shown as the API's PDF** (`DocumentPdfView`, a frame, or a button where the browser can't show PDFs inline). The editor previews through `documents.preview`.
- Tests mirror the file they test: `x.util.ts` → `x.util.test.ts`.

## Development setup

Requires Node 24, pnpm 10, Go (see `go.mod`) and the AWS CLI. The local frontend runs against the real `development` stacks.

1. **Google Cloud**: enable the Calendar and People APIs. Publish the OAuth consent screen with scopes `calendar.events`, `calendar.calendarlist.readonly` and `contacts` (in "Testing", refresh tokens expire after 7 days). Create a Web OAuth client with redirect URIs `https://<project>-<env>.auth.<region>.amazoncognito.com/oauth2/idpresponse` and `<app origin>/google-callback`.
2. `cp bizzy-infra/.env.example bizzy-infra/.env.development` and fill it in, with `http://localhost:4200/` as callback/logout URL and your email as `ALLOWED_EMAIL`.
3. `pnpm install && pnpm aws:login && pnpm dev:deploy`
4. `pnpm web:dev`, open http://localhost:4200, and connect a **test** Google account in Settings.

Staging (`main`) and production (`production`) deploy from GitHub Actions ([deploy.yml](.github/workflows/deploy.yml)). They need `cdk bootstrap`, an OIDC role (which also reads the table and invokes `migrate`), and GitHub environments with the variables and secrets that workflow lists. None exist yet.

## Commands

```sh
pnpm dev:deploy          # deploy development stacks, migrate, write bizzy-web/.env.development
pnpm lambda:deploy       # hotswap development Lambdas after Go changes, then migrate
pnpm lambda:migrate:dry  # what the next deploy's migrations would do (writes nothing)
pnpm web:dev             # http://localhost:4200
pnpm web:env             # rewrite the web env only
pnpm cdk:diff
pnpm cdk:gc              # delete old Lambda builds no stack uses from the CDK assets bucket (dev:deploy and CI deploys run it too)

pnpm web:test | web:lint | web:typecheck
pnpm infra:test | infra:lint | infra:typecheck
pnpm lambda:test | lambda:vet
```

From `bizzy-lambda/`:

```sh
go test ./internal/simulation -rapid.checks=1000 -rapid.steps=300
go test ./internal/features/documents -run TestRender -update   # rewrite the sample PDFs in testdata/ after a layout change, then open them
go test ./internal/features/settings -run TestPayPageFiles -update   # the same for the payment page and its images (testdata/paypage)
TABLE_NAME=<scratch table> go test ./internal/platform/dynamo   # the table contract against real DynamoDB; it wipes the table
```

## If share links are flooded

`public` is the only thing anyone can call; every call is billed and reads the table, whose small provisioned capacity the app shares. The account's limit of 10 concurrent executions caps a flood. If that limit is raised, cap `public` too (`reservedConcurrentExecutions: 2` in [api-stack.ts](bizzy-infra/lib/api-stack.ts)).

To stop it at once (share links fail, everything else works):

```sh
aws lambda put-function-concurrency --function-name bizzy-<env>-public \
  --reserved-concurrent-executions 0 --profile hozhuyi.dev --region ap-southeast-1
aws lambda delete-function-concurrency --function-name bizzy-<env>-public \
  --profile hozhuyi.dev --region ap-southeast-1   # turn it back on
```

Resetting a document's token kills one leaked link; this kills them all until turned back on.
