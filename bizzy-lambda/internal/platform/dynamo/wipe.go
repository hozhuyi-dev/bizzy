package dynamo

import (
	"context"
	"fmt"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// batchLimit is the most items one BatchWriteItem takes.
const batchLimit = 25

// DeleteAll deletes every item outside the kept partitions and returns how
// many it deleted. It scans the whole table, which is fine for one user's
// data and only meant for resetting a non-production environment.
func (s *Store) DeleteAll(ctx context.Context, keep ...string) (int, error) {
	kept := map[string]bool{}
	for _, pk := range keep {
		kept[pk] = true
	}

	var keys []map[string]types.AttributeValue
	pages := dynamodb.NewScanPaginator(s.Client, &dynamodb.ScanInput{
		TableName:            aws.String(s.Table),
		ProjectionExpression: aws.String("PK, SK"),
	})
	for pages.HasMorePages() {
		page, err := pages.NextPage(ctx)
		if err != nil {
			return 0, err
		}
		for _, item := range page.Items {
			pk, ok := item["PK"].(*types.AttributeValueMemberS)
			if ok && kept[pk.Value] {
				continue
			}
			keys = append(keys, map[string]types.AttributeValue{"PK": item["PK"], "SK": item["SK"]})
		}
	}

	for start := 0; start < len(keys); start += batchLimit {
		var requests []types.WriteRequest
		for _, key := range keys[start:min(start+batchLimit, len(keys))] {
			requests = append(requests, types.WriteRequest{DeleteRequest: &types.DeleteRequest{Key: key}})
		}
		if err := s.batchWrite(ctx, requests); err != nil {
			return 0, err
		}
	}
	return len(keys), nil
}

// batchAttempts bounds batchWrite's retries; the waits between them double
// from batchBackoff, about 6 s in all.
const (
	batchAttempts = 8
	batchBackoff  = 50 * time.Millisecond
)

// batchWrite retries whatever DynamoDB leaves unprocessed under throttling,
// backing off between attempts as AWS advises.
func (s *Store) batchWrite(ctx context.Context, requests []types.WriteRequest) error {
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
		out, err := s.Client.BatchWriteItem(ctx, &dynamodb.BatchWriteItemInput{
			RequestItems: map[string][]types.WriteRequest{s.Table: requests},
		})
		if err != nil {
			return err
		}
		requests = out.UnprocessedItems[s.Table]
	}
	return nil
}
