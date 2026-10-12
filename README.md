# bizzy

Back-office for a one-person physio practice. Sessions are read from Google Calendar every day and every client is linked to one of her Google contacts; she fixes what the sync couldn't read, issues receipts when a client asks (PDF, in the browser), tracks prepaid packages, follows up lapsed clients and sees how the business is doing.

| Folder | What | Stack |
| --- | --- | --- |
| `bizzy-web` | The app | React, Vite, TanStack Router / Query / Form / Table, Amplify auth, shadcn/ui |
| `bizzy-lambda` | API + daily calendar sync | Go, DynamoDB |
| `bizzy-infra` | AWS resources | CDK (TypeScript) |

Sign-in is Google via Cognito. Only `ALLOWED_EMAIL` gets AWS credentials (identity pool role mapping); the browser invokes the API Lambda directly with them.

Separately, she **connects Google** once in Settings: an OAuth consent for her calendar events and contacts (both read and write), and to list her calendars. The API keeps the refresh token in SSM (`/<project>/<env>/google-refresh-token`), and both Lambdas act as her with it. A personal Gmail can't share its contacts with a service account, so this replaces the service account the calendar used to need. The connected account can differ from the sign-in account, e.g. a test account in development.

## Calendar syntax

```
[?] <name> [amount] [NxPRICE | N@TOTAL]
```

| Title | Meaning |
| --- | --- |
| `Jane Smith` | Uses a package credit if one is left, otherwise her default rate |
| `Jane Smith 95` | Paid 95 for this session |
| `Jane Smith 10x85` | Bought 10 sessions at 85 each (850) today; this session uses the first |
| `Jane Smith 3@250` | Bought 3 sessions for 250 in total, for when the price per session isn't round |
| `Jane Smith 95 10x85` | Paid 95 for this session, and bought a package for later |
| `? Jane Smith` | Not confirmed yet; on the to-do list until the `?` is removed |

- Every timed event on the chosen calendar is a session; all-day and cancelled events are skipped. Keep personal events on another calendar.
- Names match a client's aliases (case-insensitive). A title that can't be read, or a name that matches no client, goes on the to-do list on **Home** with the fix: edit the session, link the name to a client (a near-miss typo is suggested), or create the client.
- **In the app** she can add sessions (**New session** on Sessions), confirm a tentative one from the table, or open one from the table to edit or delete it, instead of opening the calendar. Each writes to Google first (an edit carries the event's etag, so a change made on her phone meanwhile is never overwritten), then updates the session exactly as the next sync would. She fills in fields and the API writes the title in the syntax above, so app-made titles always parse and match. A session booked for later is a booking until it has happened. A session covered by a receipt can't be changed until the receipt is cancelled.
- **Home visits**: give the event the home-visit colour (Tomato by default, changeable in Settings). Any other colour means her place; no colour follows the client's "usually a home visit" setting.
- The sync re-reads the last 30 days every night (or on **Sync now**) and looks 60 days ahead for bookings. Changes made in the calendar show up after the next sync. A session with an issued receipt still follows the calendar, but a change that contradicts the receipt is flagged.

## Clients and Google Contacts

Every client links to a Google contact, picked or created when the client is added, so the details are on her phone too. The client's name and calendar aliases stay in bizzy and can differ from the contact's name.

- Google is the source of truth for email, phone and address. The client keeps a read-only copy for lists, follow-ups and receipts (issued receipts keep what they printed).
- **Edit details** in the app writes straight to Google. The edit carries the contact's etag, so if it changed on her phone in the meantime the save is refused and the latest is shown.
- Each sync re-reads her contacts and refreshes the copies. A contact deleted or merged in Google is flagged on the client and can be recreated from the copy.
- Linked contacts are added to a **Clients** label in Google Contacts.

## Receipts

Issued on request, one per paid session or package purchase. A receipt starts as a draft prefilled from the session, where everything printed can be edited freely; **Issue** takes the next number (`RCP-0001`, format and starting number in Settings). Issued receipts can be **revised** (same number, `Rev 01`, earlier revisions kept) or **cancelled** (number stays used). The lifecycle and PDF layout are generic, so other document types slot in through `documents.Types` (API) and `DOCUMENT_TYPES` (web).

## Data

One DynamoDB table: one partition per entity type (`CLIENT`, `SESSION`, `PACKAGE`, `DOC`, `GOOGLE`, …) and five generic local secondary indexes created up front, because LSIs can't be added later (see `bizzy-lambda/internal/platform/dynamo`). Each writer owns its fields on a shared item (the sync, the billing reconcile, her actions), so they never overwrite each other. Client items carry monthly activity, which the follow-up list and Insights are summed from.

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
   - OAuth consent screen: add the scopes `.../auth/calendar.readonly` and `.../auth/contacts`, and **publish it** ("In production"). In "Testing" these refresh tokens expire after 7 days and the nightly sync stops. Unverified is fine for a single user: she clicks through Google's "unverified app" warning once when connecting.
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
