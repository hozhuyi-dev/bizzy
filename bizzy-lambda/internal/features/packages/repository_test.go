package packages

import (
	"slices"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"

	"bizzy-lambda/internal/features/docref"
)

func TestEveryAttributeHasAnOwner(t *testing.T) {
	p := Package{
		ID: "p", ClientID: "c", Sessions: 1, PriceCents: 1, PurchasedAt: time.Now(), Source: SourceApp,
		Note: "n", CreditsUsed: 0, Removed: false, Drift: "d", Document: &docref.Ref{DocumentID: "d"},
	}
	item, err := attributevalue.MarshalMap(toRecord(p))
	if err != nil {
		t.Fatal(err)
	}
	for name := range item {
		if !slices.Contains(ownedAttributes, name) && !slices.Contains([]string{"PK", "SK", docref.Attribute}, name) {
			t.Errorf("attribute %q has no owner", name)
		}
	}
}
