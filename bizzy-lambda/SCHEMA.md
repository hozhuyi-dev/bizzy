# bizzy's DynamoDB schema

Generated from the code by `internal/app/schema_test.go`; do not edit. Rewrite it with
`go test ./internal/app -run TestSchema -update` and review the diff.

One table (see `internal/platform/table`). Every item has `PK` = its kind, `SK` = its id, its fields as JSON in `data`, and a sort key in each index it is filed in. Each index has one meaning for every kind, and is sparse: an item is in it only if its kind files it there.

| Index | Sort key | Lists |
|---|---|---|
| LSI1 | `<time>` | by time (`Kind.Between`) |
| LSI2 | `<clientId>#<time>` | a client's items (`Kind.OfClient`) |
| LSI3 | `<time>` | open items, for the to-do list (`Kind.Open`) |
| LSI4 | `<tag>#<time>` | by tag (`Kind.Tagged`) |
| LSI5 | `<ref>` | by what they refer to (`Kind.WithRef`) |

Every commit also moves one counter (`PK COMMIT`, `SK COUNTER`), which makes commits happen one at a time (see `internal/platform/txn`).

## Kinds

### CLIENT

A client: name, calendar names, usual fees and place, and a copy of their Google contact.

| Field | Type |
|---|---|
| id | `string` |
| name | `string` |
| aliases | `[]string` |
| feeRates | `[]clients.FeeRate` |
| homeVisits | `bool` |
| contact | `*clients.Contact` |
| lastContactedAt | `*time.Time` |

Checked on every change to one:

- **clients-have-a-name**: Every client has a name to show and to match titles by
- **names-name-one-client**: A name in a calendar title means one client, never two
- **fees-in-order**: A client's fees run in order: the first from the start, each later one from a day of its own
- **documents-are-a-clients**: Every document is for one of the clients, who isn't deleted while it is
- **clients-keep-their-packages**: A client with packages isn't deleted
- **clients-keep-their-sessions**: A client with sessions isn't deleted
- **clients-keep-their-follow-ups**: A client with follow-ups isn't deleted

### SETTINGS

The business details and preferences: one item, BUSINESS.

| Field | Type |
|---|---|
| businessName | `string` |
| registrationNo | `string` |
| address | `string` |
| email | `string` |
| phone | `string` |
| bankName | `string` |
| accountName | `string` |
| accountNo | `string` |
| serviceName | `string` |
| confirmAheadDays | `int` |
| followUpAheadDays | `int` |
| paymentMessage | `string` |
| documentMessage | `string` |

Checked on every change to one:

- **look-ahead-in-range**: The to-do list reads at most MaxAheadDays ahead

### DOC

An invoice or receipt: its issued content, and the draft being edited.

| Field | Type |
|---|---|
| id | `string` |
| type | `documents.Type` |
| status | `documents.Status` |
| clientId | `string` |
| number | `string` |
| revision | `*int` |
| content | `*documents.Content` |
| draft | `*documents.Content` |
| createdAt | `time.Time` |
| issuedAt | `*time.Time` |
| cancelledAt | `*time.Time` |
| cancelReason | `string` |
| shareToken | `string` |

| Index | For it |
|---|---|
| LSI1 time | its date (a draft has none until issued) |
| LSI2 client | its client, by date |
| LSI4 tag | its type (invoice, receipt), by date: the monthly lists |

Checked on every change to one:

- **one-live-document-of-each-type**: An item is on at most one live invoice and one live receipt, once, and its Link says which
- **paid-in-full**: What a receipt says was received for an item is what its invoice charges, and something is charged
- **documents-are-a-clients**: Every document is for one of the clients, who isn't deleted while it is
- **lifecycle**: A draft has no number; an issued or cancelled one has its number, revision and link; a cancelled one isn't being edited
- **every-issue-is-kept**: Every revision issued is kept as it was, so its PDF can be rebuilt, and its link opens it
- **package-lines-are-its-clients**: A document's line for a package is on the package's client's document
- **session-lines-are-its-clients**: A document's line for a session is on the session's client's document, and an issued invoice's sessions are confirmed

### DOCLINK

Which live document of a type covers an item: <kind>:<id>#<type>.

| Field | Type |
|---|---|
| source | `documents.Source` |
| type | `documents.Type` |
| documentId | `string` |
| owed | `bool` |

| Index | For it |
|---|---|
| LSI3 open | an invoice's, while no receipt pays it: what is owed |
| LSI5 ref | the document |

Checked on every change to one:

- **links-point-at-their-lines**: An item's link is to a live document covering it, and says rightly whether it is owed
- **paid-in-full**: What a receipt says was received for an item is what its invoice charges, and something is charged

### DOCREV

An issued revision, kept as issued: <documentId>#NN.

| Field | Type |
|---|---|
| documentId | `string` |
| revision | `int` |
| number | `string` |
| content | `documents.Content` |
| issuedAt | `time.Time` |

| Index | For it |
|---|---|
| LSI5 ref | its document |

### DOCSHARE

A share token, and the issued document it opens.

| Field | Type |
|---|---|
| token | `string` |
| documentId | `string` |

| Index | For it |
|---|---|
| LSI5 ref | the document |

### DOCNUMBER

The last number taken in a sequence: <type>#<year>.

| Field | Type |
|---|---|
| key | `string` |
| last | `int64` |

### PACKAGE

A prepaid package of sessions; its price is its invoice line.

| Field | Type |
|---|---|
| id | `string` |
| clientId | `string` |
| sessions | `int` |
| purchasedAt | `time.Time` |
| boughtIn | `string` |
| note | `string` |
| createdAt | `time.Time` |

| Index | For it |
|---|---|
| LSI1 time | when it was bought |
| LSI2 client | its client, by purchase |
| LSI5 ref | the session it was bought in |

Checked on every change to one:

- **packages-are-invoiced**: A package is always on an invoice, which says its price
- **packages-are-a-clients**: Every package is a client's
- **credits-in-hand**: No more sessions use a package's credits than it has, and a package used isn't deleted
- **bought-in-its-session**: A package bought in a session is that session's client's, bought on its day

### ATTACHMENT

A file attached to a session or an expense; the file itself is in S3.

| Field | Type |
|---|---|
| id | `string` |
| ownerKind | `attachments.OwnerKind` |
| ownerId | `string` |
| name | `string` |
| contentType | `string` |
| sizeBytes | `int64` |
| key | `string` |
| uploadedAt | `time.Time` |

| Index | For it |
|---|---|
| LSI1 time | when it was uploaded |
| LSI5 ref | its owner: <kind>:<id> |

Checked on every change to one:

- **files-are-what-was-checked**: An attachment is a photo or PDF of a size kept, at the key its owner and id give
- **records-are-a-sessions**: Notes and files are a session's, and go with it
- **receipts-are-an-expenses**: A receipt's file is an expense's, and goes with it

### SESSION

A session: who, when, where, whether confirmed, the credit paying for it, and its summary.

| Field | Type |
|---|---|
| id | `string` |
| clientId | `string` |
| start | `time.Time` |
| end | `time.Time` |
| tentative | `bool` |
| confirmedAt | `*time.Time` |
| location | `sessions.Location` |
| packageId | `string` |
| record | `*sessions.Record` |
| createdAt | `time.Time` |

| Index | For it |
|---|---|
| LSI1 time | its start |
| LSI2 client | its client, by start |
| LSI3 open | to confirm, or to record |
| LSI5 ref | the package whose credit pays for it |

Checked on every change to one:

- **sessions-never-overlap**: The user sees one client at a time
- **sessions-last-a-while**: A session ends after it starts, within a day's work, at a place
- **sessions-are-a-clients**: Every session is a client's
- **fee-or-credit**: A credit pays for a session, or its fee on an invoice: one, never both
- **credits-of-own-package**: A credit pays for a session from a package of its own client
- **confirmed-before-invoiced**: An invoice is issued, and a payment recorded, for a confirmed session only
- **bought-in-its-session**: A package bought in a session is that session's client's, bought on its day
- **records-are-a-sessions**: Notes and files are a session's, and go with it

### SESSIONNOTES

A session's long notes, apart so lists don't read them.

| Field | Type |
|---|---|
| sessionId | `string` |
| text | `string` |
| updatedAt | `time.Time` |

### FOLLOWUP

A reminder to get back to a client.

| Field | Type |
|---|---|
| id | `string` |
| clientId | `string` |
| sessionId | `string` |
| due | `time.Time` |
| allDay | `bool` |
| minutes | `int` |
| summary | `string` |
| notes | `string` |
| doneAt | `*time.Time` |
| createdAt | `time.Time` |

| Index | For it |
|---|---|
| LSI1 time | when it is due |
| LSI2 client | its client, by when due |
| LSI3 open | not done yet |
| LSI5 ref | the session it was made from |

Checked on every change to one:

- **follow-ups-are-a-clients**: Every follow-up is for one of the clients
- **follow-ups-are-due-sometime**: A follow-up is due on a day, or at a time for a while

### EXPENSE

A receipt of what the practice spent, a line per item.

| Field | Type |
|---|---|
| id | `string` |
| date | `string` |
| vendor | `string` |
| lines | `[]expenses.Line` |
| notes | `string` |
| createdAt | `time.Time` |
| updatedAt | `time.Time` |

| Index | For it |
|---|---|
| LSI1 time | its date |

Checked on every change to one:

- **expenses-are-spent-on-items**: An expense is something bought: lines of listed items, in a category, coming to more than nothing
- **receipts-are-an-expenses**: A receipt's file is an expense's, and goes with it

### EXPENSEITEM

An item expense lines are picked from, in a category.

| Field | Type |
|---|---|
| id | `string` |
| name | `string` |
| categoryId | `string` |
| archived | `bool` |
| lastAmountCents | `*int64` |

Checked on every change to one:

- **items-are-filed**: Every item is in a category

### EXPENSECATEGORIES

Every expense category, in order: one item, ALL.

| Field | Type |
|---|---|
| categories | `[]expenses.Category` |

### CONFLICT

An edit made in the calendar that bizzy refused, keyed by its event.

| Field | Type |
|---|---|
| eventId | `string` |
| itemKind | `string` |
| itemId | `string` |
| shown | `calendar.Snapshot` |
| gone | `bool` |
| message | `string` |
| remedies | `[]apperr.Remedy` |
| since | `time.Time` |

| Index | For it |
|---|---|
| LSI1 time | when it was first refused |
| LSI3 open | every one: it waits on the to-do list |
| LSI5 ref | the session or follow-up its event shows |

### EVENTLINK

Which calendar event shows which session or follow-up, and what it said when they last agreed.

| Field | Type |
|---|---|
| eventId | `string` |
| kind | `googlesync.ItemKind` |
| itemId | `string` |
| seen | `calendar.Snapshot` |
| marked | `bool` |

| Index | For it |
|---|---|
| LSI1 time | when the event is |
| LSI5 ref | the item it shows: <kind>:<id> |

Checked on every change to one:

- **one-event-per-item**: An item shows in one event, so an edit to it means one thing

### SYNC

What the sync remembers between runs: one item, CALENDAR.

| Field | Type |
|---|---|
| id | `string` |
| calendarId | `string` |
| readAt | `time.Time` |
| back | `time.Time` |
| floor | `time.Time` |
| last | `*googlesync.Run` |

### GOOGLE

The connected Google account and calendar: one item, CONNECTION.

| Field | Type |
|---|---|
| email | `string` |
| calendarId | `string` |
| calendarName | `string` |
| connectedAt | `time.Time` |
