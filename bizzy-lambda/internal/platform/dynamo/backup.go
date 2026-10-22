package dynamo

import (
	"context"
	"fmt"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
)

// Backup takes an on-demand backup of the table, named
// <table>-<name>-<time>, as a migration does before it writes anything
// (see platform/migrate). DynamoDB restores a backup into a new table.
func (t *Table) Backup(ctx context.Context, name string) error {
	full := fmt.Sprintf("%s-%s-%s", t.Name, name, time.Now().UTC().Format("20060102T150405Z"))
	_, err := t.Client.CreateBackup(ctx, &dynamodb.CreateBackupInput{TableName: aws.String(t.Name), BackupName: aws.String(full)})
	return err
}
