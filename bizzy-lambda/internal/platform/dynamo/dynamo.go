// Package dynamo is the bizzy table in DynamoDB: the production Table (see
// platform/table for the layout). Every read is consistent, and a commit is
// one transaction.
package dynamo

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strconv"

	"github.com/aws/aws-sdk-go-v2/aws"
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
	cfg, err := config.LoadDefaultConfig(ctx)
	if err != nil {
		return nil, err
	}
	return &Table{Client: dynamodb.NewFromConfig(cfg), Name: name}, nil
}

// The attributes an item is stored as.
const (
	attrData    = "data"
	attrCounter = "n"
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

func (t *Table) Counter(ctx context.Context, key table.Key) (int64, error) {
	out, err := t.Client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(t.Name), Key: keyOf(key), ConsistentRead: aws.Bool(true),
	})
	if err != nil || out.Item == nil {
		return 0, err
	}
	n, ok := out.Item[attrCounter].(*types.AttributeValueMemberN)
	if !ok {
		return 0, fmt.Errorf("dynamo: counter %v has no %s", key, attrCounter)
	}
	return strconv.ParseInt(n.Value, 10, 64)
}

func (t *Table) Commit(ctx context.Context, counter table.Key, from int64, writes []table.Write) error {
	if len(writes) > table.MaxWrites {
		return table.ErrTooBig
	}
	bump := &types.Update{
		TableName: aws.String(t.Name), Key: keyOf(counter),
		UpdateExpression:          aws.String("SET #n = :next"),
		ExpressionAttributeNames:  map[string]string{"#n": attrCounter},
		ExpressionAttributeValues: map[string]types.AttributeValue{":next": n(from + 1)},
	}
	if from == 0 {
		bump.ConditionExpression = aws.String("attribute_not_exists(#n)")
	} else {
		bump.ConditionExpression = aws.String("#n = :from")
		bump.ExpressionAttributeValues[":from"] = n(from)
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
	_, err := t.Client.TransactWriteItems(ctx, &dynamodb.TransactWriteItemsInput{TransactItems: items})
	var canceled *types.TransactionCanceledException
	if errors.As(err, &canceled) {
		for _, r := range canceled.CancellationReasons {
			if code := aws.ToString(r.Code); code == "ConditionalCheckFailed" || code == "TransactionConflict" {
				return table.ErrConflict
			}
		}
	}
	return err
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
