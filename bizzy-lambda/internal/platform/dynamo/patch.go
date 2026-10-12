package dynamo

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// Condition is a condition expression with its placeholders. Use #name and
// :value placeholders; most entity field names (status, name, date) are
// DynamoDB reserved words.
type Condition struct {
	Expression string
	Names      map[string]string
	Values     map[string]types.AttributeValue
}

// Patch writes only the attributes one writer owns and leaves the rest of the
// item alone. That is what lets the calendar sync, the billing reconcile and
// her own actions share an item without overwriting each other.
type Patch struct {
	PK, SK string
	// Set holds attributes to write; Remove names attributes to delete.
	Set    map[string]types.AttributeValue
	Remove []string
	// Increment adds 1 to each named number attribute, e.g. the version of
	// an item other writers put whole, so their next put sees the change.
	Increment []string
	When      *Condition
}

// Owned builds a patch from a marshalled item: each attribute in owned is set
// when the item has it and removed when it does not (an omitempty field that
// went back to empty).
func Owned(pk, sk string, item map[string]types.AttributeValue, owned []string) Patch {
	p := Patch{PK: pk, SK: sk, Set: map[string]types.AttributeValue{}}
	for _, name := range owned {
		if value, ok := item[name]; ok {
			p.Set[name] = value
		} else {
			p.Remove = append(p.Remove, name)
		}
	}
	return p
}

// OwnedFrom marshals a record and builds the patch for its owned attributes.
func OwnedFrom(pk, sk string, record any, owned []string) (Patch, error) {
	item, err := attributevalue.MarshalMap(record)
	if err != nil {
		return Patch{}, err
	}
	return Owned(pk, sk, item, owned), nil
}

func (p Patch) expression() (string, map[string]string, map[string]types.AttributeValue) {
	names := map[string]string{}
	values := map[string]types.AttributeValue{}

	// Sorted so the expression is stable, which keeps tests and logs readable.
	setNames := make([]string, 0, len(p.Set))
	for name := range p.Set {
		setNames = append(setNames, name)
	}
	slices.Sort(setNames)

	var sets, removes []string
	for i, name := range setNames {
		names[fmt.Sprintf("#s%d", i)] = name
		values[fmt.Sprintf(":s%d", i)] = p.Set[name]
		sets = append(sets, fmt.Sprintf("#s%d = :s%d", i, i))
	}
	for i, name := range p.Remove {
		names[fmt.Sprintf("#r%d", i)] = name
		removes = append(removes, fmt.Sprintf("#r%d", i))
	}

	var adds []string
	for i, name := range p.Increment {
		names[fmt.Sprintf("#a%d", i)] = name
		adds = append(adds, fmt.Sprintf("#a%d :one", i))
	}
	if len(adds) > 0 {
		values[":one"] = &types.AttributeValueMemberN{Value: "1"}
	}

	var parts []string
	if len(sets) > 0 {
		parts = append(parts, "SET "+strings.Join(sets, ", "))
	}
	if len(removes) > 0 {
		parts = append(parts, "REMOVE "+strings.Join(removes, ", "))
	}
	if len(adds) > 0 {
		parts = append(parts, "ADD "+strings.Join(adds, ", "))
	}

	if p.When != nil {
		for k, v := range p.When.Names {
			names[k] = v
		}
		for k, v := range p.When.Values {
			values[k] = v
		}
	}

	return strings.Join(parts, " "), names, values
}

func nilIfEmpty[K comparable, V any](m map[K]V) map[K]V {
	if len(m) == 0 {
		return nil
	}
	return m
}

// Apply runs the patch. With a condition, it reports false instead of an
// error when the condition does not hold.
func (s *Store) Apply(ctx context.Context, p Patch) (bool, error) {
	update, names, values := p.expression()
	if update == "" {
		return true, nil
	}

	input := &dynamodb.UpdateItemInput{
		TableName:                 aws.String(s.Table),
		Key:                       Key(p.PK, p.SK),
		UpdateExpression:          aws.String(update),
		ExpressionAttributeNames:  nilIfEmpty(names),
		ExpressionAttributeValues: nilIfEmpty(values),
	}
	if p.When != nil {
		input.ConditionExpression = aws.String(p.When.Expression)
	}

	_, err := s.Client.UpdateItem(ctx, input)
	if IsConditionFailed(err) {
		return false, nil
	}
	return err == nil, err
}

// TransactItem is one write in a transaction: a patch, a put or a delete.
type TransactItem struct {
	Patch  *Patch
	Put    any
	Delete *[2]string
	// When guards a put or delete.
	When *Condition
}

// ErrTransactionConflict means a condition in a transaction failed, usually
// because something changed since it was read. The caller may re-read and
// retry, or report a conflict.
var ErrTransactionConflict = errors.New("transaction condition failed")

// Transact writes all items or none.
func (s *Store) Transact(ctx context.Context, items []TransactItem) error {
	var writes []types.TransactWriteItem

	for _, item := range items {
		var write types.TransactWriteItem
		var cond *string
		var names map[string]string
		var values map[string]types.AttributeValue
		if item.When != nil {
			cond = aws.String(item.When.Expression)
			names, values = item.When.Names, item.When.Values
		}

		switch {
		case item.Patch != nil:
			update, n, v := item.Patch.expression()
			write.Update = &types.Update{
				TableName:                 aws.String(s.Table),
				Key:                       Key(item.Patch.PK, item.Patch.SK),
				UpdateExpression:          aws.String(update),
				ExpressionAttributeNames:  nilIfEmpty(n),
				ExpressionAttributeValues: nilIfEmpty(v),
			}
			if item.Patch.When != nil {
				write.Update.ConditionExpression = aws.String(item.Patch.When.Expression)
			}
		case item.Put != nil:
			av, err := attributevalue.MarshalMap(item.Put)
			if err != nil {
				return err
			}
			write.Put = &types.Put{
				TableName:                 aws.String(s.Table),
				Item:                      av,
				ConditionExpression:       cond,
				ExpressionAttributeNames:  nilIfEmpty(names),
				ExpressionAttributeValues: nilIfEmpty(values),
			}
		case item.Delete != nil:
			write.Delete = &types.Delete{
				TableName:                 aws.String(s.Table),
				Key:                       Key(item.Delete[0], item.Delete[1]),
				ConditionExpression:       cond,
				ExpressionAttributeNames:  nilIfEmpty(names),
				ExpressionAttributeValues: nilIfEmpty(values),
			}
		default:
			return errors.New("dynamo: empty transaction item")
		}

		writes = append(writes, write)
	}

	_, err := s.Client.TransactWriteItems(ctx, &dynamodb.TransactWriteItemsInput{TransactItems: writes})
	var cancelled *types.TransactionCanceledException
	if errors.As(err, &cancelled) {
		for _, reason := range cancelled.CancellationReasons {
			if aws.ToString(reason.Code) == "ConditionalCheckFailed" {
				return ErrTransactionConflict
			}
		}
	}
	return err
}
