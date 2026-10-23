package dynamo

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// BackupRetention is how long a backup is kept: the window point-in-time
// recovery already covers, after which an on-demand backup only adds to the
// bill every month.
const BackupRetention = 35 * 24 * time.Hour

// Backup takes an on-demand backup of the table, named
// <table>-<name>-<time>, as a migration does before it writes anything
// (see platform/migrate). DynamoDB restores a backup into a new table.
// It then deletes the backups it took more than BackupRetention ago.
func (t *Table) Backup(ctx context.Context, name string) error {
	now := time.Now().UTC()
	full := fmt.Sprintf("%s-%s-%s", t.Name, name, now.Format("20060102T150405Z"))
	if _, err := t.Client.CreateBackup(ctx, &dynamodb.CreateBackupInput{TableName: aws.String(t.Name), BackupName: aws.String(full)}); err != nil {
		return err
	}
	return t.pruneBackups(ctx, now.Add(-BackupRetention))
}

func (t *Table) pruneBackups(ctx context.Context, before time.Time) error {
	in := &dynamodb.ListBackupsInput{
		TableName:           aws.String(t.Name),
		BackupType:          types.BackupTypeFilterUser,
		TimeRangeUpperBound: aws.Time(before),
	}
	for {
		page, err := t.Client.ListBackups(ctx, in)
		if err != nil {
			return fmt.Errorf("list backups: %w", err)
		}
		for _, b := range page.BackupSummaries {
			if !strings.HasPrefix(aws.ToString(b.BackupName), t.Name+"-") {
				continue
			}
			if _, err := t.Client.DeleteBackup(ctx, &dynamodb.DeleteBackupInput{BackupArn: b.BackupArn}); err != nil {
				return fmt.Errorf("delete backup %s: %w", aws.ToString(b.BackupName), err)
			}
		}
		if page.LastEvaluatedBackupArn == nil {
			return nil
		}
		in.ExclusiveStartBackupArn = page.LastEvaluatedBackupArn
	}
}
