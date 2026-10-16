package dynamo_test

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"os"
	"testing"

	"bizzy-lambda/internal/platform/dynamo"
	"bizzy-lambda/internal/platform/table"
	"bizzy-lambda/internal/platform/table/tabletest"
)

// TestContract runs the table contract against a real table, when
// TABLE_NAME names one (e.g. the development stack's, with AWS credentials
// set). Each test writes under its own TEST<random># partitions, which are
// left behind; Settings → Reset clears them.
func TestContract(t *testing.T) {
	if os.Getenv("TABLE_NAME") == "" {
		t.Skip("set TABLE_NAME to run against DynamoDB")
	}
	tb, err := dynamo.New(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	tabletest.Run(t, func(*testing.T) (table.Table, string) {
		b := make([]byte, 4)
		_, _ = rand.Read(b)
		return tb, "TEST" + hex.EncodeToString(b) + "#"
	})
}
