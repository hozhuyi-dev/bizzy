package documents

// Sharing: every issued document gets a share token, and /d/<token> in the
// app shows its issued content to whoever has the link, without signing
// in (cmd/public). The token is the only permission, so it is long and
// random; links don't expire (clients come back to old receipts for
// claims), but the user can reset a token to kill links already sent.

import (
	"crypto/rand"
	"encoding/base64"
	"regexp"

	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/platform/txn"
)

// Share is what a share token opens.
type Share struct {
	Token      string `json:"token"`
	DocumentID string `json:"documentId"`
}

// Shares are found by token alone: the public link reads one item, then
// its document, and nothing else.
var Shares = txn.Kind[Share]{
	Name: "DOCSHARE", Gone: "This link doesn't work any more; ask for a new one.",
	Doc:  txn.Doc{What: "A share token, and the issued document it opens.", Ref: "the document"},
	Meta: func(s *Share) txn.Meta { return txn.Meta{ID: s.Token, Ref: s.DocumentID} },
}

// newShareToken is 128 random bits, URL-safe (22 characters).
func newShareToken() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

var shareTokenPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{22}$`)

// IsShareToken is whether token has a share token's shape. Anything else
// opens nothing, so the public link answers it without reading the table.
func IsShareToken(token string) bool {
	return shareTokenPattern.MatchString(token)
}

// share gives a document a new token, retiring its old one.
func share(tx *txn.Tx, d *Document) error {
	if d.ShareToken != "" {
		if err := Shares.Delete(tx, d.ShareToken); err != nil {
			return err
		}
	}
	d.ShareToken = newShareToken()
	return Shares.Add(tx, &Share{Token: d.ShareToken, DocumentID: d.ID})
}

// ShareAll is the share token of each issued document, by id.
func ShareAll(tx *txn.Tx, ids []string) (map[string]string, error) {
	tokens := make(map[string]string, len(ids))
	for _, id := range ids {
		d, err := Documents.Get(tx, id)
		if err != nil {
			return nil, err
		}
		if d.Status != StatusIssued {
			return nil, apperr.Refused("Only issued documents can be shared.")
		}
		tokens[id] = d.ShareToken
	}
	return tokens, nil
}

// ResetShare gives a document a new share token: links with the old one
// stop working.
func ResetShare(tx *txn.Tx, id string) (*Document, error) {
	d, err := Documents.Get(tx, id)
	if err != nil {
		return nil, err
	}
	if d.Content == nil {
		return nil, apperr.Refused("Only an issued document has a link.")
	}
	return d, share(tx, d)
}

// Open is the document a share token opens: its issued content, a
// cancelled one included (marked so), so a link already sent doesn't just
// die.
func Open(tx *txn.Tx, token string) (*Document, error) {
	gone := apperr.NotFound("%s", Shares.Gone)
	if !IsShareToken(token) {
		return nil, gone
	}
	s, ok, err := Shares.Find(tx, token)
	if err != nil || !ok {
		return nil, firstErr(err, gone)
	}
	d, ok, err := Documents.Find(tx, s.DocumentID)
	if err != nil || !ok || d.ShareToken != token || d.Content == nil {
		return nil, firstErr(err, gone)
	}
	return d, nil
}

func firstErr(err, fallback error) error {
	if err != nil {
		return err
	}
	return fallback
}
