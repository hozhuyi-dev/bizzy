package dynamo

import (
	"errors"
	"reflect"
	"strings"
	"testing"

	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"

	"bizzy-lambda/internal/platform/apperr"
)

func TestCursorRoundTrip(t *testing.T) {
	key := map[string]types.AttributeValue{
		"PK": S("SESSION"), "SK": S("abc"), "LSI2SK": S("jane#2026-10-01T02:00:00Z"),
	}
	cursor, err := encodeCursor(key)
	if err != nil {
		t.Fatal(err)
	}
	if strings.ContainsAny(cursor, "+/=") {
		t.Errorf("cursor %q is not URL-safe", cursor)
	}
	back, err := decodeCursor(cursor)
	if err != nil || !reflect.DeepEqual(back, key) {
		t.Errorf("decoded = %v, %v", back, err)
	}

	for _, bad := range []string{"not base64!", "e30", "bnVsbA"} {
		var appErr *apperr.Error
		if _, err := decodeCursor(bad); !errors.As(err, &appErr) || appErr.Code != apperr.CodeInvalid {
			t.Errorf("decodeCursor(%q) = %v, want invalid", bad, err)
		}
	}
}

func TestPatchIncrementsAlongsideSets(t *testing.T) {
	p := Patch{
		PK: "SESSION", SK: "e1",
		Set:       map[string]types.AttributeValue{"receipt": S("x")},
		Remove:    []string{"invoice"},
		Increment: []string{VersionAttribute},
	}
	update, names, values := p.expression()
	if update != "SET #s0 = :s0 REMOVE #r0 ADD #a0 :one" {
		t.Errorf("update = %q", update)
	}
	if names["#a0"] != "version" || values[":one"].(*types.AttributeValueMemberN).Value != "1" {
		t.Errorf("names %v values %v", names, values)
	}
}
