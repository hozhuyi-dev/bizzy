// Package dynamo wraps the single bizzy table.
//
// One user means tiny data, so each entity type lives in one partition
// (PK = "CLIENT", "SESSION", ...) and SK orders it. "Sessions between X and
// Y" or "all clients" is then a single Query with no index.
package dynamo

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"os"

	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
)

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
