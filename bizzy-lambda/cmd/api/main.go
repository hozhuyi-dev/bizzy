// Command api is the Lambda the web app invokes directly with identity-pool
// credentials. Every request is an {action, payload} pair; see router.
package main

import (
	"context"
	"log"

	"github.com/aws/aws-lambda-go/lambda"

	"bizzy-lambda/internal/features/clients"
	"bizzy-lambda/internal/platform/dynamo"
	"bizzy-lambda/internal/router"
)

func main() {
	store, err := dynamo.New(context.Background())
	if err != nil {
		log.Fatal(err)
	}

	r := router.New()
	clients.Register(r, clients.NewRepository(store))

	lambda.Start(r.Handle)
}
