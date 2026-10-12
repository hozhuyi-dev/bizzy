# bizzy

Back-office for a one-person physio practice. Sessions and follow-up reminders are read from Google Calendar whenever she opens the app, and every client is linked to one of her Google contacts. Each session moves from booking to notes to payment, with invoices and receipts when a client asks (PDF, in the browser); everything that needs her is one to-do list on **Home**. She also tracks prepaid packages, reconnects with lapsed clients and sees how the business is doing.

| Folder | What | Stack |
| --- | --- | --- |
| `bizzy-web` | The app | React, Vite, TanStack Router / Query / Form / Table, Amplify auth, shadcn/ui |
| `bizzy-lambda` | API, including the calendar and contacts sync | Go, DynamoDB |
| `bizzy-infra` | AWS resources | CDK (TypeScript) |

Sign-in is Google via Cognito. Only `ALLOWED_EMAIL` gets AWS credentials (identity pool role mapping); the browser invokes the API Lambda directly with them.

Separately, she **connects Google** once in Settings: an OAuth consent for her calendar events and contacts (both read and write), and to list her calendars. The API keeps the refresh token in SSM (`/<project>/<env>/google-refresh-token`), and the API acts as her with it. A personal Gmail can't share its contacts with a service account, so this replaces the service account the calendar used to need. The connected account can differ from the sign-in account, e.g. a test account in development.

## Calendar syntax

```
[?] <name> [amount] [NxPRICE | N@TOTAL]
```

| Title | Meaning |
| --- | --- |
| `Jane Smith` | Uses a package credit if one is left, otherwise her default rate |
| `Jane Smith 95` | The fee for this session is 95 |
| `Jane Smith 10x85` | Buys 10 sessions at 85 each (850), due with this session, which uses the first |
| `Jane Smith 3@250` | Buys 3 sessions for 250 in total, for when the price per session isn't round |
| `Jane Smith 95 10x85` | A fee of 95 for this session, and a package bought for later |
| `? Jane Smith` | Not confirmed yet; on the to-do list a few days before, until the `?` is removed |
| `! Jane Smith: Check MRI results` | A **follow-up**, not a session: a reminder to get back to her (see below) |

An amount is what the session costs, not that it was paid: she records the payment on the session (see [Sessions](#sessions)).

- Every timed event on the chosen calendar is a session, except follow-ups; all-day and cancelled events are skipped. Keep personal events on another calendar.
- Names match a client's aliases (case-insensitive). A title that can't be read, or a name that matches no client, goes on the to-do list on **Home** with the fix: edit the session, link the name to a client (a near-miss typo is suggested), or create the client.
- **In the app** she can add sessions (**New session** on Sessions), confirm a tentative one from the table, or open one from the table to edit or delete it, instead of opening the calendar. Each writes to Google first (an edit carries the event's etag, so a change made on her phone meanwhile is never overwritten), then updates the session exactly as the next sync would. She fills in fields and the API writes the title in the syntax above, so app-made titles always parse and match. A session covered by an invoice or receipt can't be changed until it is cancelled.
- **Home visits**: give the event the home-visit colour (Tomato by default, changeable in Settings). Any other colour means her place; no colour follows the client's "usually a home visit" setting.
- The app syncs when it opens and on **Sync now**, re-reading the last 60 days and the next 60 (bookings are sessions too). **Sync now → Sync dates…** re-reads dates she picks, or **All time**; connecting Google or choosing another calendar syncs all time. Changes made in the calendar show up after the next sync. There is no schedule: nothing changes until she opens the app. A session with an issued document still follows the calendar, but a change that contradicts the document is flagged.
- **Deleted in the calendar**: a session with nothing of hers on it is removed. One with notes, a payment or a document is kept as deleted, on the to-do list and under **Sessions → Deleted**, to **Restore** (the event comes back from Google's trash, about 30 days) or **Discard**. Deleting a session in the app removes it with its notes and payment.

### Follow-ups

`! <name>: <summary>`, timed or all-day, with any longer notes in the event's description. She can write them in the calendar or add them in the app: from a session (the event remembers which, invisibly), a client, Home, **Follow-ups**, or **Clients → Reconnect → Remind me**. Each is due on its day and comes up on the to-do list a week ahead (Settings → To do); ticking it done is kept in bizzy only.

## Sessions

A session's page walks through its steps, in a rail that shows where each stands with its dates:

1. **Booking**: when, with whom, the fee and any package bought. Confirm or cancel a tentative one.
2. **Notes**: a one-line summary (shown on the client's timeline) and long notes, saved as she types. Open once it has started. Attaching photos and PDFs is planned (S3; the seam is `platform/blobstore` and `features/attachments`).
3. **Payment**: paid (cash, Touch 'n Go, GrabPay, bank transfer; amount and day) or waived. It can come before the notes. A package credit leaves nothing to pay; a package bought in the session is due with it.
4. **Documents** (optional): an invoice once confirmed, a receipt once paid.
5. **Follow-ups** (optional), and **Next visit**: the same time a week on, in two taps.

**Home** has today's sessions and one to-do list: sessions to confirm, record, collect, fix or restore, and follow-ups due, grouped by day and filtered by kind. Confirm, mark paid and tick off happen in the list; **Next to-do** on a session's page walks through the rest. History from before **Settings → To do → Track notes and payments from** needs neither, and its fees count as received.

## Clients and Google Contacts

Every client links to a Google contact, picked or created when the client is added, so the details are on her phone too. The client's name and calendar aliases stay in bizzy and can differ from the contact's name.

- Google is the source of truth for email, phone and address. The client keeps a read-only copy for lists, follow-ups and receipts (issued receipts keep what they printed).
- **Edit details** in the app writes straight to Google. The edit carries the contact's etag, so if it changed on her phone in the meantime the save is refused and the latest is shown.
- Each sync re-reads her contacts and refreshes the copies. A contact deleted or merged in Google is flagged on the client and can be recreated from the copy.
- Linked contacts are added to a **Clients** label in Google Contacts.

## Invoices and receipts

Made on request from a session or a package: at most one invoice and one receipt each. An invoice asks for payment (with her bank details); a receipt confirms it, with how it was paid filled in from the session. Both share the same fields, lifecycle and PDF layout: a draft prefilled from what it covers, where everything printed can be edited freely; **Issue** takes the next number; issued ones can be **revised** (same number, earlier revisions kept) or **cancelled** (number stays used). Other types slot in through `documents.Types` (API) and `DOCUMENT_TYPES` (web).

Numbers are `AAAYYXXXX-ZZ`: the type (`INV`, `RCP`), the year it was issued, a count that restarts every year, and the revision from `-00`, e.g. `RCP260042-00`.

### Sending on WhatsApp

Every issued document gets a **share link**, `<app>/d/<token>`: anyone with it sees the issued content and can download the PDF, without signing in. It's served by a separate `public` Lambda (Function URL, no auth) whose role can only `GetItem`, so the signed-in API stays private. Links don't expire, because clients come back to old receipts for claims. A revision keeps the link, a cancelled document still opens marked cancelled, and **Reset link** on the document kills links already sent.

WhatsApp opens the client's chat with the message typed in. On her phone (a touch screen) that's the app, through `wa.me`. On a computer, **Settings → WhatsApp on PC** (remembered per device) picks either the browser or the desktop app. The browser opens WhatsApp Web (`web.whatsapp.com/send`), signed in there, in a new tab each time, because WhatsApp Web's security headers stop a site from reusing one tab. The desktop app opens through `whatsapp://send`, with no tab:

- **Session → Ask to pay**: what is due and her bank details, until it is paid; **Send invoice / receipt** sends the issued ones.
- **Receipt → WhatsApp**: that receipt's link. **Copy link** copies just the link.
- **Client → Receipts**: tick any issued documents, of any types, and send them in one message (or **Copy message**).

Both messages are templates in **Settings → WhatsApp messages**. `{documents}` lists each document with its link, and `{title}` reads "receipt", "receipts" or "documents".

## Data

One DynamoDB table: one partition per entity type (`CLIENT`, `SESSION`, `FOLLOWUP`, `PACKAGE`, `DOC`, `GOOGLE`, …) and five generic local secondary indexes created up front, because LSIs can't be added later. `bizzy-lambda/internal/schema/schema.go` is the one place that says how each entity is keyed (PK, SK, LSI1–5); what a row stores is its struct in the feature's `model.go`.

- Lists that only need what is "open" (the to-do list, follow-ups) read sparse indexes, never filters. Long lists (a client's timeline, follow-ups) are read a page at a time: the API returns a cursor and the app's **Load more** passes it back (`dynamo.QueryPage`). A session's long notes are their own item, so lists don't pay to read them.
- Sessions and follow-ups are written whole with a version check, since the sync, the reconcile and her edits all change them; clients and packages are patched, each writer owning its fields. Client items carry monthly activity (sessions earned, payments received), which Reconnect and Insights are summed from.

## Environments

| Branch | Environment |
| --- | --- |
| `main` | staging |
| `production` | production |

`development` is deployed from a laptop and used by the local frontend. Each environment is a separate set of stacks (`bizzy-<env>-auth|data|api|web`) in the same AWS account.

Development and staging have **Settings → Reset**, which deletes everything in the table except the Google connection, so a sync starts over from the calendar. Production has neither the button nor the API action.

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
