# bizzy

Back-office for a one-person physio practice. Sessions are read from Google Calendar every day; she fixes what the sync couldn't read, issues receipts when a client asks (PDF, in the browser), tracks prepaid packages, follows up lapsed clients and sees how the business is doing.

| Folder | What | Stack |
| --- | --- | --- |
| `bizzy-web` | The app | React, Vite, TanStack Router / Query / Form / Table, Amplify auth, shadcn/ui |
| `bizzy-lambda` | API + daily calendar sync | Go, DynamoDB |
| `bizzy-infra` | AWS resources | CDK (TypeScript) |

Sign-in is Google via Cognito. Only `ALLOWED_EMAIL` gets AWS credentials (identity pool role mapping); the browser invokes the API Lambda directly with them.

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

- Names match a client's aliases (case-insensitive). Unknown names that look like sessions, and near-miss typos, show up as **unmatched** in the app to link or create.
- Events that match no client and carry no `?` or amount are personal and skipped. All-day events are skipped.
- **Home visits**: give the event the home-visit colour (Tomato by default, changeable in Settings). Any other colour means her place; no colour follows the client's "usually a home visit" setting.
- The sync re-reads the last 30 days every night (or on **Sync now**) and looks 60 days ahead for bookings. Fix the calendar, then sync again. A session with an issued receipt still follows the calendar, but a change that contradicts the receipt is flagged.

## Receipts

Issued on request, one per paid session or package purchase. A receipt starts as a draft prefilled from the session, where everything printed can be edited freely; **Issue** takes the next number (`RCP-0001`, format and starting number in Settings). Issued receipts can be **revised** (same number, `Rev 01`, earlier revisions kept) or **cancelled** (number stays used). The lifecycle and PDF layout are generic, so other document types slot in through `documents.Types` (API) and `DOCUMENT_TYPES` (web).

## Data

One DynamoDB table: one partition per entity type (`CLIENT`, `SESSION`, `PACKAGE`, `DOC`, …) and five generic local secondary indexes created up front, because LSIs can't be added later (see `bizzy-lambda/internal/platform/dynamo`). Each writer owns its fields on a shared item (the sync, the billing reconcile, her actions), so they never overwrite each other. Client items carry monthly activity, which the follow-up list and Insights are summed from.

## Environments

| Branch | Environment |
| --- | --- |
| `main` | staging |
| `production` | production |

`development` is deployed from a laptop and used by the local frontend. Each environment is a separate set of stacks (`bizzy-<env>-auth|data|api|web`) in the same AWS account.

## One-time setup

1. **Google Cloud project**
   - OAuth client (Web application), one redirect URI per environment: `https://bizzy-<env>.auth.<region>.amazoncognito.com/oauth2/idpresponse`. Publish the consent screen.
   - Enable the Google Calendar API, create a service account and a JSON key.
   - In Google Calendar, share the calendar with the service account email ("See all event details"). Use a test calendar for development and staging.
2. **AWS**: `cdk bootstrap`, and an IAM role GitHub Actions can assume through OIDC.
3. **GitHub environments** `staging` and `production` (and `development` to deploy it from Actions):
   - Variables: `ENVIRONMENT`, `PROJECT_NAME`
   - Secrets: `AWS_ROLE_ARN`, `AWS_ACCOUNT_ID`, `AWS_REGION`, `CALLBACK_URLS`, `LOGOUT_URLS`, `ALLOWED_EMAIL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALENDAR_ID`, `SYNC_TIME_ZONE`, `GOOGLE_SERVICE_ACCOUNT_KEY`
4. Deploy once, then add the CloudFront URL from the web stack output to `CALLBACK_URLS` / `LOGOUT_URLS` and deploy again.

## Development environment

The local frontend runs against the real `development` Lambda, DynamoDB and Cognito.

1. `cp bizzy-infra/.env.example bizzy-infra/.env.development` and fill it in, with `http://localhost:4200/` as the callback and logout URL and your own email as `ALLOWED_EMAIL`.
2. Store the service account key once:
   ```sh
   aws ssm put-parameter --profile hozhuyi.dev --type SecureString --overwrite \
     --name /bizzy/development/google-service-account --value file://service-account.json
   ```
3. `pnpm dev:deploy` deploys the stacks and writes `bizzy-web/.env.development` from their outputs.
4. `pnpm web:dev` and open http://localhost:4200.

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

- **Staging / production**: GitHub environments and secrets, OIDC deploy role, Google client redirect URIs per environment, add her as a Google test user, share her calendar with the service account
