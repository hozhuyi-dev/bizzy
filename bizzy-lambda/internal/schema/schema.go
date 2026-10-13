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
//	SESSION       eventId                     start        clientId#start      start, on her to-do      status#start        -               sessions.Session
//	SESSIONNOTES  eventId                     -            -                   -                        -                   -               sessions.Notes
//	FOLLOWUP      eventId                     due          clientId#due (*)    due, until done          open|done#due       sessionId#due   followups.FollowUp
//	PACKAGE       id                          purchasedAt  clientId#purchased  purchasedAt, credits     source#purchasedAt  -               packages.Package
//	                                                                           left or unpaid
//	DOC           id                          date#created clientId#date#…     date#…, draft open       type#date#…         -               documents.Document
//	DOCREV        documentId#rev (2 digits)   -            -                   -                        -                   -               documents.Revision
//	COUNTER       type#year                   -            -                   -                        -                   -               `last`: the last number issued
//	DOCSHARE      share token                 -            -                   -                        -                   -               `documentId` a public link opens
//	ATTACHMENT    ownerKind#ownerId#id        -            -                   -                        -                   -               attachments.Attachment
//	EXPENSE       id                          date#created -                   -                        -                   -               expenses.Expense
//	EXPENSEITEM   id                          -            -                   -                        -                   -               expenses.Item
//	SETTINGS      BUSINESS                    -            -                   -                        -                   -               settings.Settings
//	SETTINGS      EXPENSECATEGORIES           -            -                   -                        -                   -               `categories`: []expenses.Category
//	GOOGLE        CONNECTION                  -            -                   -                        -                   -               googleconnect.Connection (kept by Reset)
//	SYNC          LAST                        -            -                   -                        -                   -               googlesync.Run
//
// (*) A follow-up no client matched is keyed "#due", so all of them are
// found at once, done or not, when a client gains an alias.
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
//   - Sessions and follow-ups are written whole with a version check
//     (dynamo.PutVersioned): the sync, the reconcile and her edits all change
//     them, and their index keys depend on fields from each. Clients and
//     packages are patched, each writer setting only its own attributes.
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
	Attachment       = "ATTACHMENT"
	Expense          = "EXPENSE"
	ExpenseItem      = "EXPENSEITEM"
	Settings         = "SETTINGS"
	Google           = "GOOGLE"
	SyncStatus       = "SYNC"
)

// ClientKeys keys a client.
func ClientKeys(id string) dynamo.Keys {
	return dynamo.Keys{PK: Client, SK: id}
}

// SessionKeys keys a session. open puts it in the to-do index.
func SessionKeys(eventID string, start time.Time, clientID, status string, open bool) dynamo.Keys {
	at := dynamo.TimeKey(start)
	keys := dynamo.Keys{PK: Session, SK: eventID, LSI1SK: at, LSI4SK: status + "#" + at}
	if clientID != "" {
		keys.LSI2SK = clientID + "#" + at
	}
	if open {
		keys.LSI3SK = at
	}
	return keys
}

func SessionNotesKeys(eventID string) dynamo.Keys {
	return dynamo.Keys{PK: SessionNotes, SK: eventID}
}

// FollowUpKeys keys a follow-up due at due.
func FollowUpKeys(eventID string, due time.Time, clientID string, done bool, sessionID string) dynamo.Keys {
	at := dynamo.TimeKey(due)
	state := "open"
	if done {
		state = "done"
	}
	// One no client matched is keyed "#due", so they are all found at once,
	// done or not, when a client gains an alias.
	keys := dynamo.Keys{PK: FollowUp, SK: eventID, LSI1SK: at, LSI2SK: clientID + "#" + at, LSI4SK: state + "#" + at}
	if !done {
		keys.LSI3SK = at
	}
	if sessionID != "" {
		keys.LSI5SK = sessionID + "#" + at
	}
	return keys
}

// PackageKeys keys a package. open keeps it in the open index.
func PackageKeys(id string, purchasedAt time.Time, clientID, source string, open bool) dynamo.Keys {
	at := dynamo.TimeKey(purchasedAt)
	keys := dynamo.Keys{
		PK: Package, SK: id,
		LSI1SK: at,
		LSI2SK: clientID + "#" + at,
		LSI4SK: source + "#" + at,
	}
	if open {
		keys.LSI3SK = at
	}
	return keys
}

// DocumentKeys keys a document dated date (YYYY-MM-DD). Created breaks ties
// between documents of the same day.
func DocumentKeys(id, date string, created time.Time, clientID, docType string, draftOpen bool) dynamo.Keys {
	at := date + "#" + dynamo.TimeKey(created)
	keys := dynamo.Keys{PK: Document, SK: id, LSI1SK: at, LSI4SK: docType + "#" + at}
	if clientID != "" {
		keys.LSI2SK = clientID + "#" + at
	}
	if draftOpen {
		keys.LSI3SK = at
	}
	return keys
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
