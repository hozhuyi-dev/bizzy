// Package dynamo is the bizzy table in DynamoDB: the production Table (see
// platform/table for the layout). Every read is consistent, and a commit is
// one transaction, conditional on the versions item.
package dynamo

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/aws/ratelimit"
	"github.com/aws/aws-sdk-go-v2/aws/retry"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"

	"bizzy-lambda/internal/platform/table"
)

type Table struct {
	Client *dynamodb.Client
	Name   string
}

// New opens the table named by TABLE_NAME.
func New(ctx context.Context) (*Table, error) {
	name := os.Getenv("TABLE_NAME")
	if name == "" {
		return nil, errors.New("TABLE_NAME is not set")
	}
	cfg, err := config.LoadDefaultConfig(ctx, config.WithRetryer(Retryer))
	if err != nil {
		return nil, err
	}
	return &Table{Client: dynamodb.NewFromConfig(cfg), Name: name}, nil
}

// Retryer rides out the small table's throttling: more attempts than the
// SDK's 3, backing off up to a few seconds, and no client-side retry quota,
// which a burst of throttled reads otherwise empties for every request
// after it.
func Retryer() aws.Retryer {
	return retry.NewStandard(func(o *retry.StandardOptions) {
		o.MaxAttempts = 8
		o.MaxBackoff = 4 * time.Second
		o.RateLimiter = ratelimit.None
	})
}

// The attributes an item is stored as. The versions item also counts every
// commit (attrCounter), which marks it as the versions item (see Wipe), and
// keeps each partition's version as attrVersion + the partition.
const (
	attrData    = "data"
	attrCounter = "n"
	attrVersion = "v_"
)

var indexes = []table.Index{table.ByTime, table.ByClient, table.ByOpen, table.ByTag, table.ByRef}

// sortKey is the attribute holding an index's sort key.
func sortKey(i table.Index) string {
	if i == table.ByID {
		return "SK"
	}
	return string(i) + "SK"
}

func (t *Table) Get(ctx context.Context, key table.Key) (table.Item, bool, error) {
	out, err := t.Client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(t.Name), Key: keyOf(key), ConsistentRead: aws.Bool(true),
	})
	if err != nil || out.Item == nil {
		return table.Item{}, false, err
	}
	it, err := itemOf(out.Item)
	return it, err == nil, err
}

func (t *Table) Query(ctx context.Context, q table.Query) ([]table.Item, error) {
	sk := sortKey(q.Index)
	cond := "PK = :pk"
	values := map[string]types.AttributeValue{":pk": s(q.PK)}
	switch {
	case q.Equals != "":
		cond += " AND " + sk + " = :v"
		values[":v"] = s(q.Equals)
	case q.Prefix != "":
		cond += " AND begins_with(" + sk + ", :v)"
		values[":v"] = s(q.Prefix)
	case q.From != "" && q.To != "":
		cond += " AND " + sk + " BETWEEN :from AND :to"
		values[":from"], values[":to"] = s(q.From), s(q.To)
	case q.From != "":
		cond += " AND " + sk + " >= :from"
		values[":from"] = s(q.From)
	case q.To != "":
		cond += " AND " + sk + " <= :to"
		values[":to"] = s(q.To)
	}
	in := &dynamodb.QueryInput{
		TableName: aws.String(t.Name), KeyConditionExpression: aws.String(cond),
		ExpressionAttributeValues: values, ConsistentRead: aws.Bool(true),
		ScanIndexForward: aws.Bool(!q.Desc),
	}
	if q.Index != table.ByID {
		in.IndexName = aws.String(string(q.Index))
	}
	if q.After != nil {
		in.ExclusiveStartKey = keyOf(table.Key{PK: q.PK, SK: q.After.SK})
		if q.Index != table.ByID {
			in.ExclusiveStartKey[sk] = s(q.After.SortKey)
		}
	}
	if q.Limit > 0 {
		in.Limit = aws.Int32(int32(q.Limit))
	}
	out := []table.Item{}
	pages := dynamodb.NewQueryPaginator(t.Client, in)
	for pages.HasMorePages() && (q.Limit == 0 || len(out) < q.Limit) {
		page, err := pages.NextPage(ctx)
		if err != nil {
			return nil, err
		}
		for _, raw := range page.Items {
			it, err := itemOf(raw)
			if err != nil {
				return nil, err
			}
			out = append(out, it)
		}
	}
	if q.Limit > 0 && len(out) > q.Limit {
		out = out[:q.Limit]
	}
	return out, nil
}

func (t *Table) Scan(ctx context.Context) ([]table.Item, error) {
	out := []table.Item{}
	pages := dynamodb.NewScanPaginator(t.Client, &dynamodb.ScanInput{TableName: aws.String(t.Name), ConsistentRead: aws.Bool(true)})
	for pages.HasMorePages() {
		page, err := pages.NextPage(ctx)
		if err != nil {
			return nil, err
		}
		for _, raw := range page.Items {
			if _, counter := raw[attrCounter]; counter {
				continue
			}
			it, err := itemOf(raw)
			if err != nil {
				return nil, err
			}
			out = append(out, it)
		}
	}
	return out, nil
}

func (t *Table) Versions(ctx context.Context, key table.Key) (table.Versions, error) {
	out, err := t.Client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(t.Name), Key: keyOf(key), ConsistentRead: aws.Bool(true),
	})
	if err != nil {
		return nil, err
	}
	v := table.Versions{}
	for name, av := range out.Item {
		pk, ok := strings.CutPrefix(name, attrVersion)
		n, isN := av.(*types.AttributeValueMemberN)
		if !ok || !isN {
			continue
		}
		if v[pk], err = strconv.ParseInt(n.Value, 10, 64); err != nil {
			return nil, fmt.Errorf("dynamo: version of %s: %w", pk, err)
		}
	}
	return v, nil
}

// commitAttempts bounds the retries of a commit DynamoDB throttled; the
// waits between them double from commitBackoff.
const (
	commitAttempts = 6
	commitBackoff  = 100 * time.Millisecond
)

func (t *Table) Commit(ctx context.Context, key table.Key, read table.Versions, writes []table.Write) (table.Versions, error) {
	if len(writes) > table.MaxWrites {
		return nil, table.ErrTooBig
	}
	next, err := table.Moved(read, writes)
	if err != nil {
		return nil, err
	}
	// One name per partition, for its condition and its new version alike.
	names := map[string]string{"#n": attrCounter}
	values := map[string]types.AttributeValue{":one": n(1)}
	var conds, sets []string
	i := 0
	for pk, v := range read {
		name := fmt.Sprintf("#v%d", i)
		names[name] = attrVersion + pk
		if v == 0 {
			conds = append(conds, "attribute_not_exists("+name+")")
		} else {
			conds = append(conds, fmt.Sprintf("%s = :e%d", name, i))
			values[fmt.Sprintf(":e%d", i)] = n(v)
		}
		if nv, ok := next[pk]; ok {
			sets = append(sets, fmt.Sprintf("%s = :n%d", name, i))
			values[fmt.Sprintf(":n%d", i)] = n(nv)
		}
		i++
	}
	update := "ADD #n :one"
	if len(sets) > 0 {
		update = "SET " + strings.Join(sets, ", ") + " " + update
	}
	bump := &types.Update{
		TableName: aws.String(t.Name), Key: keyOf(key),
		UpdateExpression: aws.String(update), ExpressionAttributeNames: names, ExpressionAttributeValues: values,
	}
	if len(conds) > 0 {
		bump.ConditionExpression = aws.String(strings.Join(conds, " AND "))
	}
	items := []types.TransactWriteItem{{Update: bump}}
	for _, w := range writes {
		switch {
		case w.Put != nil:
			items = append(items, types.TransactWriteItem{Put: &types.Put{TableName: aws.String(t.Name), Item: attributesOf(*w.Put)}})
		case w.Delete != nil:
			items = append(items, types.TransactWriteItem{Delete: &types.Delete{TableName: aws.String(t.Name), Key: keyOf(*w.Delete)}})
		}
	}
	for attempt := 0; ; attempt++ {
		_, err := t.Client.TransactWriteItems(ctx, &dynamodb.TransactWriteItemsInput{TransactItems: items})
		switch reason := cancelled(err); {
		case err == nil:
			return next, nil
		case reason == "ConditionalCheckFailed" || reason == "TransactionConflict":
			return nil, table.ErrConflict
		case reason == "ThrottlingError" && attempt+1 < commitAttempts:
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(commitBackoff << attempt):
			}
		default:
			return nil, err
		}
	}
}

// cancelled is why DynamoDB cancelled a transaction, if it did: the first
// reason given that isn't "None".
func cancelled(err error) string {
	var canceled *types.TransactionCanceledException
	if !errors.As(err, &canceled) {
		return ""
	}
	for _, r := range canceled.CancellationReasons {
		if code := aws.ToString(r.Code); code != "" && code != "None" {
			return code
		}
	}
	return ""
}

func attributesOf(it table.Item) map[string]types.AttributeValue {
	av := keyOf(it.Key)
	for _, i := range indexes {
		if v := it.Indexes.Of(i); v != "" {
			av[sortKey(i)] = s(v)
		}
	}
	if len(it.Data) > 0 {
		av[attrData] = s(string(it.Data))
	}
	return av
}

func itemOf(av map[string]types.AttributeValue) (table.Item, error) {
	str := func(name string) string {
		v, _ := av[name].(*types.AttributeValueMemberS)
		if v == nil {
			return ""
		}
		return v.Value
	}
	it := table.Item{
		Key: table.Key{PK: str("PK"), SK: str("SK")},
		Indexes: table.Indexes{
			Time: str(sortKey(table.ByTime)), Client: str(sortKey(table.ByClient)), Open: str(sortKey(table.ByOpen)),
			Tag: str(sortKey(table.ByTag)), Ref: str(sortKey(table.ByRef)),
		},
		Data: []byte(str(attrData)),
	}
	if len(it.Data) == 0 {
		return it, fmt.Errorf("dynamo: item %v has no %s", it.Key, attrData)
	}
	return it, nil
}

func keyOf(k table.Key) map[string]types.AttributeValue {
	return map[string]types.AttributeValue{"PK": s(k.PK), "SK": s(k.SK)}
}

func s(v string) types.AttributeValue { return &types.AttributeValueMemberS{Value: v} }
func n(v int64) types.AttributeValue {
	return &types.AttributeValueMemberN{Value: strconv.FormatInt(v, 10)}
}
