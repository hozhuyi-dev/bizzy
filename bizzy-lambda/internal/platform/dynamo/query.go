package dynamo

import (
	"context"
	"errors"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// Query reads one partition, from the table or one of its indexes.
type Query struct {
	PK string
	// Index is one of the Index constants, or empty for the table's own SK.
	Index string
	// Prefix limits the sort key to values starting with it.
	Prefix string
	// From and To limit the sort key to [From, To]. Either may be empty.
	From, To   string
	Descending bool
}

func (q Query) sortKey() string {
	if q.Index == "" {
		return "SK"
	}
	return q.Index + "SK"
}

func (q Query) input(table string) *dynamodb.QueryInput {
	condition := "PK = :pk"
	values := map[string]types.AttributeValue{":pk": S(q.PK)}
	sk := q.sortKey()

	switch {
	case q.Prefix != "":
		condition += " AND begins_with(" + sk + ", :prefix)"
		values[":prefix"] = S(q.Prefix)
	case q.From != "" && q.To != "":
		condition += " AND " + sk + " BETWEEN :from AND :to"
		values[":from"], values[":to"] = S(q.From), S(q.To)
	case q.From != "":
		condition += " AND " + sk + " >= :from"
		values[":from"] = S(q.From)
	case q.To != "":
		condition += " AND " + sk + " <= :to"
		values[":to"] = S(q.To)
	}

	input := &dynamodb.QueryInput{
		TableName:                 aws.String(table),
		KeyConditionExpression:    aws.String(condition),
		ExpressionAttributeValues: values,
		ScanIndexForward:          aws.Bool(!q.Descending),
	}
	if q.Index != "" {
		input.IndexName = aws.String(q.Index)
	}
	return input
}

// QueryAll runs a query to the end and decodes every item into T.
func QueryAll[T any](ctx context.Context, s *Store, q Query) ([]T, error) {
	paginator := dynamodb.NewQueryPaginator(s.Client, q.input(s.Table))

	all := []T{}
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, err
		}
		var items []T
		if err := attributevalue.UnmarshalListOfMaps(page.Items, &items); err != nil {
			return nil, err
		}
		all = append(all, items...)
	}
	return all, nil
}

// Get reads one item into out and reports whether it exists.
func (s *Store) Get(ctx context.Context, pk, sk string, out any) (bool, error) {
	res, err := s.Client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName:      aws.String(s.Table),
		Key:            Key(pk, sk),
		ConsistentRead: aws.Bool(true),
	})
	if err != nil {
		return false, err
	}
	if res.Item == nil {
		return false, nil
	}
	return true, attributevalue.UnmarshalMap(res.Item, out)
}

// Put replaces a whole item. Use Patch instead where several writers share
// an item.
func (s *Store) Put(ctx context.Context, item any) error {
	av, err := attributevalue.MarshalMap(item)
	if err != nil {
		return err
	}
	_, err = s.Client.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(s.Table),
		Item:      av,
	})
	return err
}

// Delete removes an item. With a condition, it reports false instead of an
// error when the condition does not hold.
func (s *Store) Delete(ctx context.Context, pk, sk string, cond *Condition) (bool, error) {
	input := &dynamodb.DeleteItemInput{
		TableName: aws.String(s.Table),
		Key:       Key(pk, sk),
	}
	if cond != nil {
		input.ConditionExpression = aws.String(cond.Expression)
		input.ExpressionAttributeNames = cond.Names
		input.ExpressionAttributeValues = cond.Values
	}
	_, err := s.Client.DeleteItem(ctx, input)
	if IsConditionFailed(err) {
		return false, nil
	}
	return err == nil, err
}

// Key builds a primary key.
func Key(pk, sk string) map[string]types.AttributeValue {
	return map[string]types.AttributeValue{"PK": S(pk), "SK": S(sk)}
}

// S is a string attribute value.
func S(value string) types.AttributeValue {
	return &types.AttributeValueMemberS{Value: value}
}

// IsConditionFailed reports whether a write was rejected by its condition.
func IsConditionFailed(err error) bool {
	var failed *types.ConditionalCheckFailedException
	return errors.As(err, &failed)
}
