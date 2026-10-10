package clients

import (
	"context"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"

	"bizzy-lambda/internal/platform/dynamo"
)

const partition = "CLIENT"

type record struct {
	PK string `dynamodbav:"PK"`
	SK string `dynamodbav:"SK"`
	Client
}

type Repository struct {
	store *dynamo.Store
}

func NewRepository(store *dynamo.Store) Repository {
	return Repository{store: store}
}

func (r Repository) List(ctx context.Context) ([]Client, error) {
	paginator := dynamodb.NewQueryPaginator(r.store.Client, &dynamodb.QueryInput{
		TableName:              aws.String(r.store.Table),
		KeyConditionExpression: aws.String("PK = :pk"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":pk": &types.AttributeValueMemberS{Value: partition},
		},
	})

	all := []Client{}
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, err
		}
		var records []record
		if err := attributevalue.UnmarshalListOfMaps(page.Items, &records); err != nil {
			return nil, err
		}
		for _, rec := range records {
			all = append(all, rec.Client)
		}
	}

	return all, nil
}

func (r Repository) Put(ctx context.Context, client Client) error {
	item, err := attributevalue.MarshalMap(record{PK: partition, SK: client.ID, Client: client})
	if err != nil {
		return err
	}

	_, err = r.store.Client.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(r.store.Table),
		Item:      item,
	})
	return err
}
