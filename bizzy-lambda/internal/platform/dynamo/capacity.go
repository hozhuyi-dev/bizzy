package dynamo

import (
	"context"
	"fmt"
	"math"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// The table's provisioned capacity is small (see bizzy-infra's DataTable):
// plenty for one user's requests, but hours for a run over every item, as
// a migration's review or a copy makes. Boost raises it for such a run,
// only as far as the run needs, and sets it back after: capacity is billed
// by the hour it is set at, used or not.

// Capacity is reads and writes a second, in DynamoDB's units.
type Capacity struct {
	Reads, Writes int64
}

// Whole is a run over every item: how many times it reads each, and how
// many times it writes each.
type Whole struct {
	Reads, Writes int
}

const (
	// wholeIn is how long a run over every item should take at most,
	// well inside the migrate Lambda's 15 minutes.
	wholeIn = 5 * time.Minute
	// writesPerItem is what writing an item costs: 2 in a transaction,
	// and 1 for each index it is in.
	writesPerItem = 5
	// maxBoost bounds what a run raises either to: about a dollar an hour.
	maxBoost = 1000
)

// Need is the capacity a run over every item of the table takes in
// wholeIn, from its size as DynamoDB last reported it (every 6 hours or
// so).
func (t *Table) Need(ctx context.Context, w Whole) (Capacity, error) {
	out, err := t.Client.DescribeTable(ctx, &dynamodb.DescribeTableInput{TableName: aws.String(t.Name)})
	if err != nil {
		return Capacity{}, err
	}
	secs := wholeIn.Seconds()
	// A consistent read costs a unit per 4 KB.
	reads := float64(aws.ToInt64(out.Table.TableSizeBytes)) / 4096 * float64(w.Reads) / secs
	writes := float64(aws.ToInt64(out.Table.ItemCount)) * writesPerItem * float64(w.Writes) / secs
	return Capacity{Reads: int64(math.Ceil(reads)), Writes: int64(math.Ceil(writes))}, nil
}

// Boost raises the table's capacity to at least need (up to maxBoost),
// waiting until it is in effect. restore sets it back; it does nothing
// when nothing was raised, or for a table billed by the request.
func (t *Table) Boost(ctx context.Context, need Capacity) (restore func(context.Context) error, err error) {
	restore = func(context.Context) error { return nil }
	out, err := t.Client.DescribeTable(ctx, &dynamodb.DescribeTableInput{TableName: aws.String(t.Name)})
	if err != nil {
		return restore, err
	}
	if s := out.Table.BillingModeSummary; s != nil && s.BillingMode == types.BillingModePayPerRequest {
		return restore, nil
	}
	was := Capacity{
		Reads:  aws.ToInt64(out.Table.ProvisionedThroughput.ReadCapacityUnits),
		Writes: aws.ToInt64(out.Table.ProvisionedThroughput.WriteCapacityUnits),
	}
	to := Capacity{
		Reads:  max(was.Reads, min(need.Reads, maxBoost)),
		Writes: max(was.Writes, min(need.Writes, maxBoost)),
	}
	if to == was {
		return restore, nil
	}
	if err := t.setCapacity(ctx, to); err != nil {
		return restore, err
	}
	return func(ctx context.Context) error { return t.setCapacity(ctx, was) }, nil
}

func (t *Table) setCapacity(ctx context.Context, c Capacity) error {
	_, err := t.Client.UpdateTable(ctx, &dynamodb.UpdateTableInput{
		TableName:             aws.String(t.Name),
		ProvisionedThroughput: &types.ProvisionedThroughput{ReadCapacityUnits: aws.Int64(c.Reads), WriteCapacityUnits: aws.Int64(c.Writes)},
	})
	if err == nil {
		err = dynamodb.NewTableExistsWaiter(t.Client).Wait(ctx, &dynamodb.DescribeTableInput{TableName: aws.String(t.Name)}, 5*time.Minute)
	}
	if err != nil {
		return fmt.Errorf("dynamo: set %s's capacity to %d reads and %d writes a second: %w", t.Name, c.Reads, c.Writes, err)
	}
	return nil
}
