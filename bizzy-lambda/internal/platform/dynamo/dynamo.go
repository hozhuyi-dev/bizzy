// Package dynamo wraps the single bizzy table.
//
// One user means tiny data, so each entity type lives in one partition
// (PK = "CLIENT", "SESSION", ...) and SK identifies the item. Other orders
// come from five generic local secondary indexes whose sort keys each entity
// fills in as it needs (see the Index constants). LSIs can only be created
// with the table, so all five exist from the start; an entity that needs a
// new order writes the attribute, and anything cross-partition can still get
// a GSI later without recreating the table.
package dynamo

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"os"
	"time"

	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
)

// Local secondary indexes. Every one projects all attributes and is sparse:
// an item without the sort key attribute is not in the index.
const (
	// IndexTime orders an entity by its main date: "<time>".
	IndexTime = "LSI1"
	// IndexClient groups an entity by client: "<clientId>#<time>".
	IndexClient = "LSI2"
	// IndexOpen holds only items that need her attention: "<time>".
	IndexOpen = "LSI3"
	// IndexCategory groups by a kind or status: "<category>#<time>".
	IndexCategory = "LSI4"
	// LSI5 is spare.
)

// Keys are the key attributes every item carries. Entities embed it in their
// DynamoDB record alongside their own fields.
type Keys struct {
	PK     string `dynamodbav:"PK"`
	SK     string `dynamodbav:"SK"`
	LSI1SK string `dynamodbav:"LSI1SK,omitempty"`
	LSI2SK string `dynamodbav:"LSI2SK,omitempty"`
	LSI3SK string `dynamodbav:"LSI3SK,omitempty"`
	LSI4SK string `dynamodbav:"LSI4SK,omitempty"`
}

// IndexAttributes are the LSI sort keys, which whoever writes an entity's
// derived fields also owns.
var IndexAttributes = []string{"LSI1SK", "LSI2SK", "LSI3SK", "LSI4SK"}

type Store struct {
	Client *dynamodb.Client
	Table  string
}

// New builds a store from the Lambda environment.
func New(ctx context.Context) (*Store, error) {
	table := os.Getenv("TABLE_NAME")
	if table == "" {
		return nil, errors.New("TABLE_NAME is not set")
	}

	cfg, err := config.LoadDefaultConfig(ctx)
	if err != nil {
		return nil, err
	}

	return &Store{Client: dynamodb.NewFromConfig(cfg), Table: table}, nil
}

// NewID returns a random 16-character hex id.
func NewID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// TimeKey formats a time for a sort key. Always UTC: Google returns local
// offsets, and "…+08:00" strings do not sort in time order against "…Z".
func TimeKey(t time.Time) string {
	return t.UTC().Format(time.RFC3339)
}
