package dynamo

import (
	"context"
	"fmt"
	"slices"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// batchLimit is the most writes one BatchWriteItem takes.
const batchLimit = 25

// Wipe scans the whole table, which is fine for one user's data and only
// meant for starting a test environment over.
func (t *Table) Wipe(ctx context.Context, keep ...string) (int, error) {
	var doomed []map[string]types.AttributeValue
	pages := dynamodb.NewScanPaginator(t.Client, &dynamodb.ScanInput{
		TableName:                aws.String(t.Name),
		ProjectionExpression:     aws.String("PK, SK, #d, #n"),
		ExpressionAttributeNames: map[string]string{"#d": attrData, "#n": attrCounter},
	})
	for pages.HasMorePages() {
		page, err := pages.NextPage(ctx)
		if err != nil {
			return 0, err
		}
		for _, av := range page.Items {
			pk, _ := av["PK"].(*types.AttributeValueMemberS)
			_, readable := av[attrData]
			_, counter := av[attrCounter]
			if pk != nil && slices.Contains(keep, pk.Value) && (readable || counter) {
				continue
			}
			doomed = append(doomed, map[string]types.AttributeValue{"PK": av["PK"], "SK": av["SK"]})
		}
	}
	for start := 0; start < len(doomed); start += batchLimit {
		var requests []types.WriteRequest
		for _, key := range doomed[start:min(start+batchLimit, len(doomed))] {
			requests = append(requests, types.WriteRequest{DeleteRequest: &types.DeleteRequest{Key: key}})
		}
		if err := t.batchWrite(ctx, requests); err != nil {
			return 0, err
		}
	}
	return len(doomed), nil
}

// batchAttempts bounds batchWrite's retries; the waits between them double
// from batchBackoff, about 6 s in all.
const (
	batchAttempts = 8
	batchBackoff  = 50 * time.Millisecond
)

// batchWrite retries whatever DynamoDB leaves unprocessed under
// throttling, backing off between attempts as AWS advises.
func (t *Table) batchWrite(ctx context.Context, requests []types.WriteRequest) error {
	for attempt := 0; len(requests) > 0; attempt++ {
		if attempt == batchAttempts {
			return fmt.Errorf("dynamo: %d writes still unprocessed", len(requests))
		}
		if attempt > 0 {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(batchBackoff << (attempt - 1)):
			}
		}
		out, err := t.Client.BatchWriteItem(ctx, &dynamodb.BatchWriteItemInput{
			RequestItems: map[string][]types.WriteRequest{t.Name: requests},
		})
		if err != nil {
			return err
		}
		requests = out.UnprocessedItems[t.Name]
	}
	return nil
}
