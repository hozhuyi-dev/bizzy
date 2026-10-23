package googleauth

import (
	"encoding/base64"
	"errors"
	"fmt"
	"net/url"
	"testing"

	"golang.org/x/oauth2"
)

func TestEmailFrom(t *testing.T) {
	payload := base64.RawURLEncoding.EncodeToString([]byte(`{"email":"her@gmail.com","sub":"1"}`))
	if got := emailFrom("header." + payload + ".signature"); got != "her@gmail.com" {
		t.Errorf("emailFrom = %q", got)
	}
	if got := emailFrom("not a token"); got != "" {
		t.Errorf("emailFrom(garbage) = %q, want empty", got)
	}
}

func TestErr(t *testing.T) {
	// How an API call reports a failed refresh: the HTTP client wraps the
	// token source's error in a url.Error.
	revoked := &url.Error{Op: "Get", URL: "https://people.googleapis.com", Err: &oauth2.RetrieveError{ErrorCode: "invalid_grant"}}

	if got := Err(revoked); got != ErrRevoked {
		t.Errorf("Err(invalid_grant) = %v, want ErrRevoked", got)
	}
	if got := Wrap("list contacts", revoked); !errors.Is(got, ErrRevoked) {
		t.Errorf("Wrap lost ErrRevoked: %v", got)
	}

	other := fmt.Errorf("boom")
	if got := Err(other); got != other {
		t.Errorf("Err(other) = %v, want it unchanged", got)
	}
	if Wrap("x", nil) != nil {
		t.Error("Wrap(nil) must stay nil")
	}
}
