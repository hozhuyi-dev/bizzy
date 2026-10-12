package dynamo

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"

	"bizzy-lambda/internal/platform/apperr"
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

// Page is one page of a query. Next is empty on the last page; otherwise it
// is the cursor that reads the page after this one.
type Page[T any] struct {
	Items []T    `json:"items"`
	Next  string `json:"next,omitempty"`
}

// MaxPageSize caps what one page may ask for, whatever the app sends.
const MaxPageSize = 100

// QueryPage reads at most limit items starting after cursor (empty for the
// first page). DynamoDB counts Limit before any filter, so pages stay exact
// only because nothing here filters: views that need a subset read a sparse
// index instead.
//
// The cursor is DynamoDB's LastEvaluatedKey (the item's table and index
// keys, all strings here), base64url JSON so the app can hand it back as is.
func QueryPage[T any](ctx context.Context, s *Store, q Query, limit int, cursor string) (Page[T], error) {
	input := q.input(s.Table)
	input.Limit = aws.Int32(int32(min(max(limit, 1), MaxPageSize)))
	if cursor != "" {
		start, err := decodeCursor(cursor)
		if err != nil {
			return Page[T]{}, err
		}
		input.ExclusiveStartKey = start
	}

	out, err := s.Client.Query(ctx, input)
	if err != nil {
		return Page[T]{}, err
	}
	page := Page[T]{Items: []T{}}
	if err := attributevalue.UnmarshalListOfMaps(out.Items, &page.Items); err != nil {
		return Page[T]{}, err
	}
	if len(out.LastEvaluatedKey) > 0 {
		if page.Next, err = encodeCursor(out.LastEvaluatedKey); err != nil {
			return Page[T]{}, err
		}
	}
	return page, nil
}

// ErrBadCursor is a cursor this package did not hand out.
var ErrBadCursor = apperr.Invalid("that page link is no longer valid; start from the first page")

func encodeCursor(key map[string]types.AttributeValue) (string, error) {
	plain := make(map[string]string, len(key))
	for name, value := range key {
		s, ok := value.(*types.AttributeValueMemberS)
		if !ok {
			return "", fmt.Errorf("dynamo: key attribute %s is not a string", name)
		}
		plain[name] = s.Value
	}
	raw, err := json.Marshal(plain)
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}

func decodeCursor(cursor string) (map[string]types.AttributeValue, error) {
	raw, err := base64.RawURLEncoding.DecodeString(cursor)
	if err != nil {
		return nil, ErrBadCursor
	}
	var plain map[string]string
	if err := json.Unmarshal(raw, &plain); err != nil || plain["PK"] == "" {
		return nil, ErrBadCursor
	}
	key := make(map[string]types.AttributeValue, len(plain))
	for name, value := range plain {
		key[name] = S(value)
	}
	return key, nil
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

// ErrConflict means a versioned write found the item changed (or created,
// or deleted) since it was read. The caller reads it again and retries.
var ErrConflict = errors.New("dynamo: item changed since it was read")

// VersionAttribute is the optimistic-lock counter on versioned items.
const VersionAttribute = "version"

// VersionIs guards a write on the version read: 0 means the item must not
// exist yet.
func VersionIs(previous int) *Condition {
	if previous == 0 {
		return &Condition{Expression: "attribute_not_exists(PK)"}
	}
	return &Condition{
		Expression: "#version = :version",
		Names:      map[string]string{"#version": VersionAttribute},
		Values:     map[string]types.AttributeValue{":version": &types.AttributeValueMemberN{Value: strconv.Itoa(previous)}},
	}
}

// PutVersioned replaces a whole item if it is still at the version read
// (0: if it does not exist yet). The item carries its new version, which is
// the caller's to bump. It returns ErrConflict otherwise.
func (s *Store) PutVersioned(ctx context.Context, item any, previous int) error {
	av, err := attributevalue.MarshalMap(item)
	if err != nil {
		return err
	}
	cond := VersionIs(previous)
	_, err = s.Client.PutItem(ctx, &dynamodb.PutItemInput{
		TableName:                 aws.String(s.Table),
		Item:                      av,
		ConditionExpression:       aws.String(cond.Expression),
		ExpressionAttributeNames:  cond.Names,
		ExpressionAttributeValues: cond.Values,
	})
	if IsConditionFailed(err) {
		return ErrConflict
	}
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
