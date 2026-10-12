package documents

// Sharing: every issued document gets a share token, and /d/<token> in the
// app shows its issued content to whoever has the link, without signing in.
// The token is the only permission, so it is long and random; links don't
// expire (clients come back to old receipts for claims), but she can reset a
// token to kill links already sent.

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"regexp"
	"time"

	"bizzy-lambda/internal/platform/apperr"
)

// newShareToken returns 128 random bits, URL-safe (22 characters).
func newShareToken() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

var shareTokenPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{22}$`)

type shareInput struct {
	IDs []string `json:"ids"`
}

// share returns the share token of each issued document, by id, giving one
// to any issued before documents had them.
func (h handler) share(ctx context.Context, in shareInput) (any, error) {
	if len(in.IDs) == 0 {
		return nil, apperr.Invalid("choose what to share")
	}
	tokens := make(map[string]string, len(in.IDs))
	for _, id := range in.IDs {
		doc, err := h.load(ctx, id, 0)
		if err != nil {
			return nil, err
		}
		if doc.Status != StatusIssued {
			return nil, apperr.Conflict("only issued documents can be shared")
		}
		if doc.ShareToken == "" {
			if doc, err = h.newShareToken(ctx, doc); err != nil {
				return nil, err
			}
		}
		tokens[id] = doc.ShareToken
	}
	return tokens, nil
}

// resetShare gives a document a new share token; links with the old one
// stop working.
func (h handler) resetShare(ctx context.Context, in idInput) (any, error) {
	doc, err := h.load(ctx, in.ID, in.Version)
	if err != nil {
		return nil, err
	}
	if doc.Content == nil {
		return nil, apperr.Conflict("only an issued document has a link")
	}
	return h.newShareToken(ctx, doc)
}

func (h handler) newShareToken(ctx context.Context, doc Document) (Document, error) {
	updated := doc
	updated.ShareToken = newShareToken()
	updated.Version++
	w := Write{
		Doc:             updated,
		PreviousVersion: doc.Version,
		Share:           &ShareChange{New: updated.ShareToken, Old: doc.ShareToken},
	}
	if err := h.commit(ctx, w); err != nil {
		return doc, err
	}
	return updated, nil
}

// Shared is what a share link shows: the issued content, never a draft or a
// revision in progress.
type Shared struct {
	Type        Type       `json:"type"`
	Status      Status     `json:"status"`
	Number      string     `json:"number"`
	Revision    *int       `json:"revision,omitempty"`
	Content     Content    `json:"content"`
	CancelledAt *time.Time `json:"cancelledAt,omitempty"`
}

// SharedStore is all the public link reads.
type SharedStore interface {
	SharedID(ctx context.Context, token string) (string, bool, error)
	Get(ctx context.Context, id string) (Document, bool, error)
}

// ReadShared returns the document a share token opens. A cancelled one is
// still shown, marked cancelled, so a link already sent doesn't just die.
func ReadShared(ctx context.Context, repo SharedStore, token string) (Shared, error) {
	notFound := apperr.NotFound("this link doesn't work any more; ask for a new one")
	if !shareTokenPattern.MatchString(token) {
		return Shared{}, notFound
	}
	id, found, err := repo.SharedID(ctx, token)
	if err != nil || !found {
		return Shared{}, firstErr(err, notFound)
	}
	doc, found, err := repo.Get(ctx, id)
	if err != nil || !found {
		return Shared{}, firstErr(err, notFound)
	}
	// The token must still be the document's own: a reset retires the old.
	if doc.ShareToken != token || doc.Content == nil {
		return Shared{}, notFound
	}
	return Shared{
		Type:        doc.Type,
		Status:      doc.Status,
		Number:      doc.Number,
		Revision:    doc.Revision,
		Content:     *doc.Content,
		CancelledAt: doc.CancelledAt,
	}, nil
}

func firstErr(err, fallback error) error {
	if err != nil {
		return err
	}
	return fallback
}
