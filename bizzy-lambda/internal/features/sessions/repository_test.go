package sessions

import (
	"slices"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"

	"bizzy-lambda/internal/features/docref"
)

// Every stored attribute must be owned by Save or be one of hers; a new field
// left out of ownedAttributes would silently never be written.
func TestEveryAttributeHasAnOwner(t *testing.T) {
	fee := int64(1)
	s := Session{
		EventID: "e", Title: "t", Start: time.Now(), End: time.Now(), ColorID: "1", Removed: true,
		Status: StatusPriced, Name: "n", ClientID: "c", SuggestedClientID: "c", FeeCents: &fee,
		FeeSource: FeeFromTitle, PackageID: "p", ValueCents: 1, Location: LocationHome,
		LocationSource: "colour", Reason: "r", Drift: "d", Ignored: true, Document: &docref.Ref{DocumentID: "d"},
	}
	item, err := attributevalue.MarshalMap(toRecord(s))
	if err != nil {
		t.Fatal(err)
	}
	for name := range item {
		if !slices.Contains(ownedAttributes, name) && !slices.Contains([]string{"PK", "SK", "ignored", docref.Attribute}, name) {
			t.Errorf("attribute %q has no owner", name)
		}
	}
}
