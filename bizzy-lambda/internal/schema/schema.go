// Package schema is the one place that says how every entity is keyed in
// the single bizzy table: its partition (PK), sort key (SK) and what each of
// the five local secondary indexes (LSI1–LSI5) holds for it. Repositories
// build their keys only through the functions here.
//
// What a row stores is the entity's struct in its feature's model.go: every
// field with a `dynamodbav` tag is an attribute, alongside the keys
// (dynamo.Keys) its repository adds.
//
//	PK            SK                          LSI1 time    LSI2 client         LSI3 open                LSI4 category       LSI5 relation   Stores (model.go)
//	CLIENT        id                          -            -                   -                        -                   -               clients.Client
//	SESSION       id                          start        clientId#start      start, on her to-do      start, push pending packageId#start sessions.Session
//	SESSIONNOTES  sessionId                   -            -                   -                        -                   -               sessions.Notes
//	FOLLOWUP      id                          due          clientId#due        due, until done          open|done#due       sessionId#due   followups.FollowUp
//	PACKAGE       id                          purchasedAt  clientId#purchased  purchasedAt, while to-do -                   -               packages.Package
//	DOC           id                          date#created clientId#date#…     -                        type#date#…         -               documents.Document
//	DOCREV        documentId#rev (2 digits)   -            -                   -                        -                   -               documents.Revision
//	COUNTER       type#year | slot#day        -            -                   -                        -                   -               `last`: the last number issued, or a day's bookings changed
//	DOCSHARE      share token                 -            -                   -                        -                   -               `documentId` a public link opens
//	EXTERNAL      surface#externalId          -            -                   -                        -                   -               conflicts.External: what a Google record shows
//	CONFLICT      surface#externalId          at           clientId#at         at, while open           -                   targetId#at     conflicts.Conflict
//	ATTACHMENT    ownerKind#ownerId#id        -            -                   -                        -                   -               attachments.Attachment
//	EXPENSE       id                          date#created -                   -                        -                   -               expenses.Expense
//	EXPENSEITEM   id                          -            -                   -                        -                   -               expenses.Item
//	SETTINGS      BUSINESS                    -            -                   -                        -                   -               settings.Settings
//	SETTINGS      EXPENSECATEGORIES           -            -                   -                        -                   -               `categories`: []expenses.Category
//	GOOGLE        CONNECTION                  -            -                   -                        -                   -               googleconnect.Connection (kept by Reset)
//	SYNC          LAST                        -            -                   -                        -                   -               googlesync.Run
//	JOURNAL       id                          -            -                   -                        -                   -               recovery.Entry: a mutation running, or that died
//
// A draft document has no date yet, so it sorts before every issued one in
// LSI1 and LSI2, and never matches a month in LSI4.
//
// A day's slot counter moves on with every change that books a session on
// that day (UTC), so two changes that would book overlapping sessions can't
// both commit: the second one reads again and is refused.
//
// The table design, in short (see platform/dynamo for the mechanics):
//   - One partition per entity type. One user means little data, and a
//     partition key value with LSIs holds up to 10 GB, which is decades of a
//     one-person practice. Files never go in the table (items are capped at
//     400 KB): they go to S3, see platform/blobstore.
//   - The SK identifies the item; the LSIs give other orders within the
//     partition. Each index is sparse: an item without that sort key is not
//     in it, which is how "open" lists stay small without filters.
//   - Index conventions, so every entity reads alike: LSI1 time, LSI2
//     client, LSI3 open (only while it needs her), LSI4 category, LSI5
//     relation.
//   - Times in keys are UTC RFC 3339 (dynamo.TimeKey), so they sort.
//   - Sessions, packages, documents and follow-ups are written whole with a
//     version check, together in one transaction per change (see the book
//     feature), so what they copy from each other never disagrees. Clients
//     are patched, each writer setting only its own attributes.
//   - What a Google record (a calendar event, a contact) shows is looked
//     up by EXTERNAL, keyed by the surface it lives on ("calendar",
//     "contacts") and its id there, so one record shows one thing; an edit
//     made there that isn't allowed waits as a CONFLICT under the same key.
//   - Long text that lists don't show (session notes) lives in its own item:
//     a read is billed for the whole item, so lists stay cheap.
package schema

import (
	"fmt"
	"time"

	"bizzy-lambda/internal/platform/dynamo"
)

// Partitions.
const (
	Client           = "CLIENT"
	Session          = "SESSION"
	SessionNotes     = "SESSIONNOTES"
	FollowUp         = "FOLLOWUP"
	Package          = "PACKAGE"
	Document         = "DOC"
	DocumentRevision = "DOCREV"
	Counter          = "COUNTER"
	DocumentShare    = "DOCSHARE"
	External         = "EXTERNAL"
	Conflict         = "CONFLICT"
	Attachment       = "ATTACHMENT"
	Expense          = "EXPENSE"
	ExpenseItem      = "EXPENSEITEM"
	Settings         = "SETTINGS"
	Google           = "GOOGLE"
	SyncStatus       = "SYNC"
	Journal          = "JOURNAL"
)

// ClientKeys keys a client.
func ClientKeys(id string) dynamo.Keys {
	return dynamo.Keys{PK: Client, SK: id}
}

// SessionKeys keys a session. open puts it in the to-do index, pending in
// the index of sessions whose event is still to be written, and packageID
// is the package whose credit covers it.
func SessionKeys(id string, start time.Time, clientID string, open, pending bool, packageID string) dynamo.Keys {
	at := dynamo.TimeKey(start)
	keys := dynamo.Keys{PK: Session, SK: id, LSI1SK: at, LSI2SK: clientID + "#" + at}
	if open {
		keys.LSI3SK = at
	}
	if pending {
		keys.LSI4SK = at
	}
	if packageID != "" {
		keys.LSI5SK = packageID + "#" + at
	}
	return keys
}

func SessionNotesKeys(sessionID string) dynamo.Keys {
	return dynamo.Keys{PK: SessionNotes, SK: sessionID}
}

// FollowUpKeys keys a follow-up due at due.
func FollowUpKeys(id string, due time.Time, clientID string, done bool, sessionID string) dynamo.Keys {
	at := dynamo.TimeKey(due)
	state := "open"
	if done {
		state = "done"
	}
	keys := dynamo.Keys{PK: FollowUp, SK: id, LSI1SK: at, LSI2SK: clientID + "#" + at, LSI4SK: state + "#" + at}
	if !done {
		keys.LSI3SK = at
	}
	if sessionID != "" {
		keys.LSI5SK = sessionID + "#" + at
	}
	return keys
}

// PackageKeys keys a package. open keeps it in the open index.
func PackageKeys(id string, purchasedAt time.Time, clientID string, open bool) dynamo.Keys {
	at := dynamo.TimeKey(purchasedAt)
	keys := dynamo.Keys{PK: Package, SK: id, LSI1SK: at, LSI2SK: clientID + "#" + at}
	if open {
		keys.LSI3SK = at
	}
	return keys
}

// DocumentKeys keys a document dated date (YYYY-MM-DD; "" for a draft not
// issued yet). Created breaks ties between documents of the same day.
func DocumentKeys(id, date string, created time.Time, clientID, docType string) dynamo.Keys {
	at := date + "#" + dynamo.TimeKey(created)
	return dynamo.Keys{PK: Document, SK: id, LSI1SK: at, LSI2SK: clientID + "#" + at, LSI4SK: docType + "#" + at}
}

func DocumentRevisionKeys(documentID string, revision int) dynamo.Keys {
	return dynamo.Keys{PK: DocumentRevision, SK: fmt.Sprintf("%s#%02d", documentID, revision)}
}

// CounterKeys keys one type's numbering for one year.
func CounterKeys(docType string, year int) dynamo.Keys {
	return dynamo.Keys{PK: Counter, SK: fmt.Sprintf("%s#%d", docType, year)}
}

func DocumentShareKeys(token string) dynamo.Keys {
	return dynamo.Keys{PK: DocumentShare, SK: token}
}

// ExternalKeys keys what a record on a Google surface shows.
func ExternalKeys(surface, externalID string) dynamo.Keys {
	return dynamo.Keys{PK: External, SK: surface + "#" + externalID}
}

// ConflictKeys keys a refused edit of a record on a Google surface. open
// keeps it in the open index.
func ConflictKeys(key string, at time.Time, clientID, targetID string) dynamo.Keys {
	t := dynamo.TimeKey(at)
	keys := dynamo.Keys{PK: Conflict, SK: key, LSI1SK: t, LSI2SK: clientID + "#" + t, LSI3SK: t}
	if targetID != "" {
		keys.LSI5SK = targetID + "#" + t
	}
	return keys
}

// AttachmentPrefix is the SK prefix of one owner's attachments.
func AttachmentPrefix(ownerKind, ownerID string) string {
	return ownerKind + "#" + ownerID + "#"
}

func AttachmentKeys(ownerKind, ownerID, id string) dynamo.Keys {
	return dynamo.Keys{PK: Attachment, SK: AttachmentPrefix(ownerKind, ownerID) + id}
}

// ExpenseKeys keys an expense dated date (YYYY-MM-DD). Created breaks ties
// between expenses of the same day.
func ExpenseKeys(id, date string, created time.Time) dynamo.Keys {
	return dynamo.Keys{PK: Expense, SK: id, LSI1SK: date + "#" + dynamo.TimeKey(created)}
}

func ExpenseItemKeys(id string) dynamo.Keys {
	return dynamo.Keys{PK: ExpenseItem, SK: id}
}

func ExpenseCategoriesKeys() dynamo.Keys { return dynamo.Keys{PK: Settings, SK: "EXPENSECATEGORIES"} }

func SettingsKeys() dynamo.Keys   { return dynamo.Keys{PK: Settings, SK: "BUSINESS"} }
func GoogleKeys() dynamo.Keys     { return dynamo.Keys{PK: Google, SK: "CONNECTION"} }
func SyncStatusKeys() dynamo.Keys { return dynamo.Keys{PK: SyncStatus, SK: "LAST"} }

func JournalKeys(id string) dynamo.Keys { return dynamo.Keys{PK: Journal, SK: id} }
