# bizzy

Back-office for a one-person physio practice. bizzy is where her sessions are: Google Calendar shows them, and is where she can also book and change them, read whenever she opens the app. Every client is linked to one of her Google contacts. Each session moves from booking to notes to payment; its fee is its invoice and its payment its receipt, issued (PDF, in the browser) when a client asks; everything that needs her is one to-do list on **Home**. She also tracks prepaid packages, records expenses with their receipts, reconnects with lapsed clients and sees how the business is doing.

| Folder | What | Stack |
| --- | --- | --- |
| `bizzy-web` | The app | React, Vite, TanStack Router / Query / Form / Table, Amplify auth, shadcn/ui |
| `bizzy-lambda` | API, including the calendar and contacts sync | Go, DynamoDB |
| `bizzy-infra` | AWS resources | CDK (TypeScript) |

Sign-in is Google via Cognito. Only `ALLOWED_EMAIL` gets AWS credentials (identity pool role mapping); the browser invokes the API Lambda directly with them.

Separately, she **connects Google** once in Settings: an OAuth consent for her calendar events and contacts (both read and write), and to list her calendars. The API keeps the refresh token in SSM (`/<project>/<env>/google-refresh-token`), and the API acts as her with it. A personal Gmail can't share its contacts with a service account, so this replaces the service account the calendar used to need. The connected account can differ from the sign-in account, e.g. a test account in development.

## Calendar syntax

```
[?] <name> [(V) | (H)] [amount] [NxPRICE | N@TOTAL]
```

| Title | Meaning |
| --- | --- |
| `Jane Smith` | Uses a package credit if one is left, otherwise the client's fee on that day |
| `Jane Smith 95` | The fee for this session is 95 |
| `Jane Smith (V)` | A home visit, at the client's; `(H)` is at her own place. Without either, the client's usual place |
| `Jane Smith 10x85` | Buys 10 sessions at 85 each (850), collected with this session, which uses the first |
| `Jane Smith 3@250` | Buys 3 sessions for 250 in total, for when the price per session isn't round |
| `Jane Smith 95 10x85` | A fee of 95 for this session, and a package bought for later |
| `? Jane Smith` | Not confirmed yet; on the to-do list a few days before, until the `?` is removed |
| `! Jane Smith: Check MRI results` | A **follow-up**, not a session: a reminder to get back to her (see below) |

An amount is what the session costs, not that it was paid: she records the payment on the session (see [Sessions](#sessions)).

- Every timed event on the chosen calendar is a session, except follow-ups; all-day and cancelled events are skipped. Keep personal events on another calendar. An event stays what it was read as: a session's event can't become a follow-up (or an all-day event), nor the other way round.
- **The calendar asks; bizzy decides.** bizzy is where sessions and follow-ups are true, and each one's event shows it. An edit she makes in the calendar (a new event, a move, a new fee, a `?` removed, a deleted event) is read at the next sync as the change it asks for, and decided by exactly the same rules as the same change made in the app. Allowed, it is applied; refused, nothing changes, and it waits on the to-do list on **Home** with why and what to do: **Undo it in the calendar** (the event is written back, or restored from Google's trash, or made again if the trash is empty), take one of the refusal's suggestions there (which then applies the edit too), or, for a new event that isn't bizzy's, **Not a session**. A waiting edit is judged again after every change in bizzy: once something done elsewhere (perhaps for another reason) lets it through, it says **Ready to apply** and waits for her to **Apply it**, rather than applying by itself. A new event, and edits refused only for the order a sync read them in, apply as soon as they can. Two bookings dragged into each other's times move together.
- Names match a client's aliases (case-insensitive). A new event under a name no client has, a title that can't be read, or a booking with no fee known (no amount, no package credit, no usual fee) waits on the to-do list with the fix: add the name to a client (a near-miss typo is suggested), add the client, give the client a usual fee, or say it isn't a session.
- **In the app** she can add sessions (**New session** on Sessions), confirm a tentative one, or open one to edit or delete it. The change is decided and saved in bizzy, then written to its event; an edit of hers waiting on that event is settled by it.
- **Where**: `(V)` is a home visit and `(H)` her own place (a new place, such as a centre she works from, would be another letter). Without either, a session is at the client's usual place ("usually a home visit" on the client). bizzy writes the mark only when the session isn't at the client's usual place, so changing a client's usual place re-marks their events. Event colours are hers: bizzy neither reads nor writes them.
- **One client at a time**: sessions never overlap, whoever's they are (back to back is fine). A booking over another, in the app or the calendar, is refused, the calendar's waiting with **Undo** or **Move** the other session. A duplicated event (Google's **Duplicate**) is a new session once it is moved to a free time.
- The app syncs when it opens and on **Sync now**, re-reading the last 60 days and the next 60 (bookings are sessions too). **Sync now → Sync dates…** re-reads dates she picks, or **All time**; connecting Google or choosing another calendar syncs all time. There is no schedule: nothing changes until she opens the app.
- **Issued documents stay as they say.** A calendar edit that would change what an issued invoice or receipt says (its client, fee or payment) is refused like any other, with **Cancel** the document as the way (and, once built, a credit or debit note). Moving a session on an issued document is allowed: its service date is corrected in the document's next revision, drafted for her to issue.
- **A package bought in a title** (`10x85`) is that session's. Editing the `10x85` away deletes it, unless sessions use its credits, it was paid, or it is on an issued invoice: then the edit waits, offering to **Keep it as a package on its own**.
- **Deleted in the calendar**: a session with nothing of hers on it is deleted. One with notes or files, money received or an issued document is kept, and the deletion waits on the to-do list: restore the event, or delete it in the app. Deleting a session in the app removes it with its notes and files (not while money was received or an invoice issued: undo or cancel first), and its event.

### Follow-ups

`! <name>: <summary>`, timed or all-day, with any longer notes in the event's description. Like sessions, they are true in bizzy and shown by their events: she can write or change them in the calendar (read at the next sync, and decided like the same change in the app) or add them in the app: from a session, a client, Home, **Follow-ups**, or **Clients → Reconnect → Remind me**. A name no client has waits on the to-do list until a client has it. Each is due on its day and comes up on the to-do list a week ahead (Settings → To do); ticking it done is kept in bizzy only.

## Sessions

A session's page walks through its steps, in a rail that shows where each stands with its dates:

1. **Booking**: when, with whom, the fee and any package bought. Confirm or cancel a tentative one.
2. **Notes**: a one-line summary (shown on the client's timeline) and long notes, saved as she types, and attached photos and PDFs (see [Files](#files)). Open once it has started.
3. **Payment**: paid (cash, Touch 'n Go, GrabPay, bank transfer; and the day), always in full. It can come before the notes. A package credit leaves nothing to pay. A package bought in the session has its own payment: she marks the session's fee and the package paid together or one at a time. Recording a payment drafts its receipt; to waive a fee, set it to nothing before the invoice is issued.
4. **Documents**: the session's invoice is drafted with the booking (its fee is the invoice's line; the package bought in it goes on the same draft) and its receipt with the payment. **Issue** one when the client asks; until then anything on it can change.
5. **Follow-ups** (optional), and **Next visit**: the same time a week on, in two taps.

**Home** has today's sessions and one to-do list: sessions to confirm, record or collect, packages to collect, calendar edits to settle, and follow-ups due, grouped by day and filtered by kind. Most of it is cleared in the list: confirm, **Add summary** (the one line that counts as recorded; long notes stay on the session's page), **Paid ▾** by method (a session's fee and the package it bought together or either alone, or another day), a calendar edit's suggestions, and ticking off follow-ups. **Next to-do** on a session's page walks through the rest. A package bought in a session is collected on that session's row; only one bought on its own has its own.

When the app refuses something (an issued document it would change, a payment it would contradict), it says why with buttons for what would let it through.

### Packages

Prepaid sessions, bought in a session's title (`10x85`) or added on **Packages**. A session booked without an amount takes a credit of the client's oldest package with one left, bought by then; once given, a credit stays with its session (it never moves to another behind her back). Each package is on an invoice (its price is the invoice's line) and paid in full on its own, any time: it counts as income the day it is paid, not the day it is bought. Adding one in the app can record it as paid there and then; otherwise it goes on the to-do list to collect. A package can't lose credits sessions use: it stays as it is for them.

## Clients and Google Contacts

Every client links to a Google contact, picked or created when the client is added, so the details are on her phone too. The client's name and calendar aliases stay in bizzy and can differ from the contact's name.

- **Fee**: what a session with no amount in its title and no package credit costs, kept as a list of fees with the day each starts. The first covers everything before the next. A session takes its fee when it is booked; saving new fees reprices the sessions on the usual fee that are neither paid nor on an issued invoice (their draft invoices change), and leaves the rest as they were charged.
- Google is the source of truth for email, phone and address. The client keeps a read-only copy for lists, follow-ups and receipts (issued receipts keep what they printed).
- **Edit details** in the app writes straight to Google. The edit carries the contact's etag, so if it changed on her phone in the meantime the save is refused and the latest is shown.
- Each sync re-reads her contacts and refreshes the copies. A contact deleted or merged in Google is flagged on the client and can be recreated from the copy.
- Linked contacts are added to a **Clients** label in Google Contacts.

## Expenses

What the practice spends, one **expense** per receipt: the day, where it was bought (Shopee, a shop), a line per item with its amount, notes, and the receipt itself as files (optional: a toll has none).

- A line names an **item** from her list (**Expenses → Items**). Typing a new name adds it to the list with the category she picks; picking one already there fills in its category and what it last cost. A line keeps the item's name and category as they were when written, so renaming an item or moving it to another category later leaves recorded years as they were.
- **Categories** follow the business expenses on LHDN's Form B (purchases, rental, salaries, travel, repairs, promotion, other expenses, …), plus equipment claimed through capital allowances and non-allowable spending, so a year's totals per category are what the tax return asks for. Should the form change, she renames, adds, reorders or archives them in **Expenses → Categories**; one is never deleted, since lines are filed under it.
- **Expenses** shows a calendar year (the tax year): spent, received (from client payments) and what is left, totals per category, and every receipt.

## Files

Photos and PDFs attached to a session (a swelling, an MRI report, a referral letter) or an expense (its receipt). The browser shrinks a photo to 2000 px before upload, asks the API for a presigned URL, uploads straight to S3, then confirms it; the API checks what arrived and records it. An upload never confirmed (a closed tab) is tagged pending and the bucket expires it after a day. Files open through links that last an hour.

- One private bucket per environment, in the `bizzy-<env>-data` stack beside the table, with keys made of ids only, never names, since keys end up in logs and URLs: `attachments/<ownerKind>/<ownerId>/<attachmentId>/original.<ext>`. A new kind of owner is a new `<ownerKind>`; files the app makes itself would go under another top-level prefix (e.g. `exports/`).
- The API's role can only touch `attachments/*`; the signed-in role has no S3 access at all, only the URLs the API signs.
- Production keeps old versions of a deleted or replaced file for 35 days (the table's point-in-time recovery window). Development and staging keep none, and **Reset** empties the bucket too.

## Invoices and receipts

Where bizzy keeps money: a session's or package's fee is its invoice's line, and what was received its receipt's. An invoice is drafted with every booked session (its fee) and package (its price), and a receipt with every payment, so each is on exactly one live invoice and, once paid, one receipt. Drafts of one client's can be combined (a month on one invoice) or split. An invoice asks for payment (with her bank details); a receipt confirms it, with how it was paid. Both share the same fields, lifecycle and PDF layout:

- Before it is **issued**, anything on a draft can change; changing an amount on a draft invoice changes the fee. **Issue** takes the next number and freezes it.
- An issued document is a business record. A **revision** (same number, earlier revisions kept) may only correct what has no legal weight: descriptions, service dates, notes, contact and bank details, and the client's name as printed. What it charges or confirms, to which client and when it was issued never change: those go through a new document. For now that is **Cancel** (the number stays used, and its lines go back to a draft); credit and debit notes are a seam (`documents.Types`' `Effect`), to build when a case needs one, e.g. waiving a fee already invoiced.
- Other types slot in through `documents.Types` (API) and `DOCUMENT_TYPES` (web).

Numbers are `AAAYYXXXX-ZZ`: the type (`INV`, `RCP`), the year it was issued, a count that restarts every year, and the revision from `-00`, e.g. `RCP260042-00`.

### Sending on WhatsApp

Every issued document gets a **share link**, `<app>/d/<token>`: anyone with it sees the issued content and can download the PDF, without signing in. It's served by a separate `public` Lambda (Function URL, no auth) whose role can only `GetItem`, so the signed-in API stays private. Links don't expire, because clients come back to old receipts for claims. A revision keeps the link, a cancelled document still opens marked cancelled, and **Reset link** on the document kills links already sent.

WhatsApp opens the client's chat with the message typed in. On her phone (a touch screen) that's the app, through `wa.me`. On a computer, **Settings → WhatsApp on PC** (remembered per device) picks either the browser or the desktop app. The browser opens WhatsApp Web (`web.whatsapp.com/send`), signed in there, in a new tab each time, because WhatsApp Web's security headers stop a site from reusing one tab. The desktop app opens through `whatsapp://send`, with no tab:

- **Session → Ask to pay**: what is due and her bank details, until it is paid; **Send invoice / receipt** sends the issued ones.
- **Receipt → WhatsApp**: that receipt's link. **Copy link** copies just the link.
- **Client → Receipts**: tick any issued documents, of any types, and send them in one message (or **Copy message**).

Both messages are templates in **Settings → WhatsApp messages**. `{documents}` lists each document with its link, and `{title}` reads "receipt", "receipts" or "documents".

## Code layout

Both apps are organised by feature (vertical slices). A feature owns its types, data access and endpoints or screens.

### bizzy-lambda

- `internal/features/<feature>/` is one slice; the package is the business name, so files are named by layer only: `sessions/handler.go`, not `sessions.handler.go`.
- Fixed layer files:

  | File | Holds |
  | --- | --- |
  | `model.go` | Domain types and pure logic on them, plus the package doc |
  | `repository.go` | DynamoDB records and the `Repository` |
  | `handler.go` | `Register` (each action as `Query` or `Mutation`), input structs and thin handler methods (validate, delegate) |
  | `service.go` | Use cases spanning several reads/writes, when a slice needs them (`documents`, `sessions`) |
  | `state.go` | The entity reduced to independent axes (small enums) and `State()` |
  | `rules.go` | Its rule table: what is quiet, needs action, contradicts something outside the app, or is impossible; the to-do list is derived from it |
  | `guards.go` | Preconditions of the mutations on it, returning the error shown |
  | `view.go` | What the API returns: the entity with its state, rules, to-do and `can` verdicts, so bizzy-web never re-derives a rule |
  | `google.go` | The Google API client (`calendar`, `contacts`) |

- Every combination of a slice's axes, classified by its rules, is in `testdata/states.md`; `go test ./... -run TestStates -update` regenerates it after a change to `state.go` or `rules.go`, so review shows which states moved.
- Anything else is named after what it does, never `util` or `helper`: `syncer.go`, `numbering.go`, `share.go`, `ledger.go`, `<entity>_commands.go`. Use `snake_case` for two words (`event_reader.go`), never a trailing `_<os>` or `_<arch>`, which Go reads as a build constraint.
- Each file holds one layer. Tests mirror the file they test: `x.go` → `x_test.go`.
- Dependencies point one way: workflow slices (`book`, `googlesync`, `todo`) may import core slices (`clients`, `sessions`, `packages`, `documents`, `conflicts`, `settings`, `followups`), never the reverse. `calendar` imports no feature. Interfaces are declared where they are used.
- **`book` is the only way sessions, packages, their documents and follow-ups change.** Each change is a command (`session_commands.go`, `package_commands.go`, `payment_commands.go`, `document_commands.go`, `followup_commands.go`), applied to a copy of the client's book and judged by one guard table (`guards.go`): each row compares the book before and after, so it judges what a command does, not what it says. A refusal names its guard and the remedies that would let it through (shown as buttons). `Derive` (`derive.go`) then writes every copied field (a session's fee from its invoice line, a package's credits from the sessions using them), the invariants (`invariants.go`) are checked, and the change commits in one transaction. `testdata/guards.md` lists every guard with what it checks, keeps and offers; `go test ./internal/features/book -run TestGuards -update` regenerates it. A new rule is one row there. `machine_test.go` runs the guard table as a pure machine (`command.Machine`): thousands of random command sequences on an in-memory book a second, checking nothing the guards let through breaks anything; `-guards.necessity` turns each guard off in turn and requires a run that then breaks something, so no guard is dead weight.
- **`googlesync` makes Google Calendar a command surface** for sessions and follow-ups: an edit there is read (`event_reader.go`) as the same command the app sends, so the calendar can do exactly what the app can; a refused one is kept as a `conflicts.Conflict` with the guards' remedies. Every change in bizzy is written to its event (`event_writer.go`). `conflicts` is keyed by surface and external id (`EXTERNAL`, `CONFLICT`), so another surface plugs in the same way. Google Contacts stays the source of truth for contact details, which the sync copies.
- `platform/command` is the guard table itself (`Guard`, `Decide`, `Violation`, `Remedy`, the golden table); `platform/statemodel` the axes and rule tables.
- Outside features: `internal/shared/` for types several slices share with no behaviour of their own (`docref`, `money`), `internal/platform/` for infrastructure (`dynamo`, `googleauth`, `ssm`, `apperr`, `statemodel`, `command`), `internal/schema` for every key, `internal/router` for dispatch, `internal/app` for wiring every domain action (used by `cmd/api` and the simulation), `internal/testutil/` for in-memory stores and fake Google services.
- `internal/integrity` checks everything at once: each entity's impossible rules, the book's invariants over everything stored, and the links no book can see: issued revisions and share links, what each calendar event shows (`rules_links.go`); attachments, their owners and their files (`rules_files.go`); expense lines, items and categories (`rules_expenses.go`). A rule marked `Pending` is a known gap with its suggested fix (`testdata/links.md`).
- `internal/simulation` drives the app with random sequences of user actions (`actions_user.go`, one per router mutation, enforced by a test), Google Calendar and Contacts edits, time passing and crashes, checking after every step that nothing is impossible, refused actions change nothing, derived fields are current, the calendar mirrors bizzy (every event shows its session, or waits as a conflict), user actions never bring on a conflict, and the to-do list can always be emptied with the remedies it offers. `scenario.calendarVsApp` makes one edit in the calendar and the same in the app, on copies of the world, and requires the same outcome. Search deeper with `-rapid.checks=2000 -rapid.steps=200`; `-sim.report=file.md` writes which actions moved which entity between rule states. A new feature adds its `state.go`, `rules.go`, guards and simulation actions.

### bizzy-web

- `src/features/<feature>/` is one slice. Files are `<kebab-name>.<layer>.ts(x)`, with exactly one dot before the layer; the name is the feature or a topic in it: `sessions.query.ts`, `session-stage.util.ts`, never `sessions.stage.ts`.
- Layers, in dependency order (each may import those above it):

  | Layer | Holds |
  | --- | --- |
  | `types` | Types and interfaces only, no runtime code; API mirrors name their Go model |
  | `constant` | Runtime constants and option lists, with types derived from them |
  | `util` | Pure functions |
  | `form` | Form values ↔ API types, and validation |
  | `service` | Side effects: `invoke` the API, storage, `window` |
  | `query` / `mutation` | `useQuery` / `useMutation` hooks over a service; a mutation owns its invalidation |
  | `hook` | Other hooks: flows with toasts or navigation, external stores |
  | `columns` | Table columns, their cells, row actions and the phone card |
  | `component` | Components |

- Pages sit at the feature root as `x-page.component.tsx`; every other component goes in `components/<name>/`, which may hold its own `<name>.hook.ts` or `<name>.util.ts`.
- Components reach data only through `query`, `mutation` and `hook`, never a `service` or `lambda.client`. A type, constant or helper used outside its component file moves to the feature's layer file.
- Within a feature import relatively; across features and from core use `~/`. Pages don't import from other pages.
- Tests mirror the file they test: `x.util.ts` → `x.util.test.ts`.
- Outside features: `core/` holds what every feature shares (`lambda/lambda.client.ts`, `config/*.config.ts`, `constants/`, `utils/*.util.ts`, and shared behaviour with no UI of its own, such as `scroll-spy/`), `components/shared/` the app's own shared components, `components/ui/` shadcn's (generated, left as is), and `routes/` TanStack's file routes, which only read params and search and render a page.

## Data

One DynamoDB table: one partition per entity type (`CLIENT`, `SESSION`, `FOLLOWUP`, `PACKAGE`, `DOC`, `EXPENSE`, `ATTACHMENT`, `GOOGLE`, …) and five generic local secondary indexes created up front, because LSIs can't be added later. `bizzy-lambda/internal/schema/schema.go` is the one place that says how each entity is keyed (PK, SK, LSI1–5); what a row stores is its struct in the feature's `model.go`.

- Lists that only need what is "open" (the to-do list, follow-ups) read sparse indexes, never filters. Long lists (a client's timeline, follow-ups) are read a page at a time: the API returns a cursor and the app's **Load more** passes it back (`dynamo.QueryPage`). A session's long notes are their own item, so lists don't pay to read them.
- Sessions, packages, documents and follow-ups are written whole with a version check, in one transaction per change (the book), so what they copy from each other never disagrees; a day's slot counter moves with every booking on it, so two changes can't book overlapping sessions at once. Expenses are written whole with a version check too; clients and expense items are patched, each writer owning its fields. Sessions and follow-ups have ids of their own: `EXTERNAL` says which one a calendar event shows, and `CONFLICT` holds an edit made there that wasn't applied.
- Files never go in the table (items are capped at 400 KB): they are in S3 (see [Files](#files)), with one `ATTACHMENT` item each and a count on their owner. Client items carry monthly activity (sessions earned, payments received), which Reconnect and Insights are summed from.

## Environments

| Branch | Environment |
| --- | --- |
| `main` | staging |
| `production` | production |

`development` is deployed from a laptop and used by the local frontend. Each environment is a separate set of stacks (`bizzy-<env>-auth|data|api|web`) in the same AWS account.

Development and staging have **Settings → Reset**, which deletes everything in the table except the Google connection, and every attached file, then syncs the whole calendar back in. Production has neither the button nor the API action: issued invoices and receipts must be kept, and production starts empty when first deployed anyway.

## One-time setup

1. **Google Cloud project**
   - Enable the **Google Calendar API** and the **People API**.
   - Branding: app name, support email, home page `<app URL>/` and privacy policy `<app URL>/privacy.html` (served from `bizzy-web/public/privacy.html`), with the CloudFront domain under authorized domains. Leave the logo empty: one triggers brand verification.
   - OAuth consent screen: add the scopes `.../auth/calendar.readonly` and `.../auth/contacts`, and **publish it** ("In production"). In "Testing" these refresh tokens expire after 7 days and the sync stops until she reconnects. Unverified is fine for a single user: she clicks through Google's "unverified app" warning once when connecting.
   - OAuth client (Web application), two redirect URIs per environment:
     - `https://bizzy-<env>.auth.<region>.amazoncognito.com/oauth2/idpresponse` (sign-in)
     - `<app origin>/google-callback` (connecting Google), e.g. `http://localhost:4200/google-callback` for development
2. **AWS**: `cdk bootstrap`, and an IAM role GitHub Actions can assume through OIDC.
3. **GitHub environments** `staging` and `production` (and `development` to deploy it from Actions):
   - Variables: `ENVIRONMENT`, `PROJECT_NAME`
   - Secrets: `AWS_ROLE_ARN`, `AWS_ACCOUNT_ID`, `AWS_REGION`, `CALLBACK_URLS`, `LOGOUT_URLS`, `ALLOWED_EMAIL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SYNC_TIME_ZONE`
4. Deploy once, then add the CloudFront URL from the web stack output to `CALLBACK_URLS` / `LOGOUT_URLS` (and `<url>/google-callback` to the Google OAuth client) and deploy again.
5. Sign in, open **Settings → Connect Google**, and pick the calendar sessions are booked in. Connect a test Google account (with a test calendar and contacts) in development and staging, so nothing touches her real contacts.

## Development environment

The local frontend runs against the real `development` Lambda, DynamoDB and Cognito.

1. `cp bizzy-infra/.env.example bizzy-infra/.env.development` and fill it in, with `http://localhost:4200/` as the callback and logout URL and your own email as `ALLOWED_EMAIL`.
2. `pnpm dev:deploy` deploys the stacks and writes `bizzy-web/.env.development` from their outputs.
3. `pnpm web:dev`, open http://localhost:4200 and connect a test Google account in Settings.

After changing Go code, `pnpm lambda:deploy` hotswaps the development Lambdas in seconds.

## Commands

Requires Node 24, pnpm 10, Go and the AWS CLI.

```sh
pnpm install
pnpm aws:login
pnpm dev:deploy       # deploy development + write the web env
pnpm web:dev          # http://localhost:4200
pnpm web:env          # rewrite the web env only (ENVIRONMENT defaults to development)
pnpm lambda:deploy    # hotswap development Lambdas
pnpm lambda:test
pnpm infra:test
pnpm web:test
```

## Remaining work

- **Staging / production**: GitHub environments and secrets, OIDC deploy role, Google client redirect URIs per environment (sign-in and `/google-callback`), publish the consent screen, connect Google in each environment
