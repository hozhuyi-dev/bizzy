// Package googleauth holds her Google authorisation: one refresh token she
// grants once in Settings, which the calendar sync and the contacts features
// both act with. A personal Gmail account can't share its contacts with a
// service account, so the app acts as her instead.
package googleauth

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"sync"

	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"

	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/platform/ssm"
)

const (
	ScopeContacts = "https://www.googleapis.com/auth/contacts"
	// ScopeEvents reads and writes events; ScopeCalendarList only lists her
	// calendars, to choose the one the sync reads.
	ScopeEvents       = "https://www.googleapis.com/auth/calendar.events"
	ScopeCalendarList = "https://www.googleapis.com/auth/calendar.calendarlist.readonly"
)

// Scopes are what the app asks for. openid and email only name the account
// in Settings.
var Scopes = []string{"openid", "email", ScopeContacts, ScopeEvents, ScopeCalendarList}

var (
	ErrNotConnected = apperr.Disconnected("Google isn't connected yet. Connect it in Settings.")
	ErrRevoked      = apperr.Disconnected("Google access was revoked or has expired. Reconnect it in Settings.")
)

// TokenStore keeps the refresh token. Get returns "" before she connects.
type TokenStore interface {
	Get(ctx context.Context) (string, error)
	Put(ctx context.Context, token string) error
	Delete(ctx context.Context) error
}

// ParamTokens keeps the refresh token in one SecureString parameter.
type ParamTokens string

func (p ParamTokens) Get(ctx context.Context) (string, error) {
	token, err := ssm.SecureString(ctx, string(p))
	if errors.Is(err, ssm.ErrNotFound) {
		return "", nil
	}
	return token, err
}

func (p ParamTokens) Put(ctx context.Context, token string) error {
	return ssm.PutSecureString(ctx, string(p), token)
}

func (p ParamTokens) Delete(ctx context.Context) error {
	return ssm.Delete(ctx, string(p))
}

type Auth struct {
	config oauth2.Config
	tokens TokenStore

	// The token source is kept while the stored refresh token stays the
	// same, so a warm Lambda reuses its access token. The store is re-read
	// on every call because the other Lambda may have reconnected.
	mu      sync.Mutex
	refresh string
	source  oauth2.TokenSource
}

func New(clientID, clientSecret string, tokens TokenStore) *Auth {
	return &Auth{
		config: oauth2.Config{
			ClientID:     clientID,
			ClientSecret: clientSecret,
			Endpoint:     google.Endpoint,
			Scopes:       Scopes,
		},
		tokens: tokens,
	}
}

// Grant is what her consent gave.
type Grant struct {
	RefreshToken string
	// Email is the Google account she chose, which may not be the one she
	// signs in with (a test account in development).
	Email string
}

// Exchange trades the code from Google's consent screen for a refresh
// token. redirectURI must be the one the browser sent her to Google with.
func (a *Auth) Exchange(ctx context.Context, code, redirectURI string) (Grant, error) {
	cfg := a.config
	cfg.RedirectURL = redirectURI

	token, err := cfg.Exchange(ctx, code)
	if err != nil {
		slog.WarnContext(ctx, "google code exchange failed", "error", err)
		return Grant{}, apperr.Invalid("Google didn't accept the sign-in. Please connect again.")
	}
	if token.RefreshToken == "" {
		return Grant{}, apperr.Invalid("Google didn't grant offline access. Please connect again.")
	}

	granted, _ := token.Extra("scope").(string)
	scopes := strings.Fields(granted)
	for _, required := range []string{ScopeContacts, ScopeEvents, ScopeCalendarList} {
		if !slices.Contains(scopes, required) {
			return Grant{}, apperr.Invalid("Allow access to both your contacts and your calendar, then connect again.")
		}
	}

	idToken, _ := token.Extra("id_token").(string)
	return Grant{RefreshToken: token.RefreshToken, Email: emailFrom(idToken)}, nil
}

// Store saves a refresh token from Exchange.
func (a *Auth) Store(ctx context.Context, refreshToken string) error {
	return a.tokens.Put(ctx, refreshToken)
}

// Revoke tells Google to forget the grant and deletes the stored token. A
// token Google already forgot is deleted all the same.
func (a *Auth) Revoke(ctx context.Context) error {
	token, err := a.tokens.Get(ctx)
	if err != nil {
		return err
	}
	if token != "" {
		form := url.Values{"token": {token}}
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://oauth2.googleapis.com/revoke", strings.NewReader(form.Encode()))
		if err != nil {
			return err
		}
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		if res, err := http.DefaultClient.Do(req); err != nil {
			slog.WarnContext(ctx, "google revoke failed", "error", err)
		} else {
			_ = res.Body.Close()
		}
	}
	return a.tokens.Delete(ctx)
}

// Client returns an HTTP client that acts as her.
func (a *Auth) Client(ctx context.Context) (*http.Client, error) {
	source, err := a.tokenSource(ctx)
	if err != nil {
		return nil, err
	}
	return oauth2.NewClient(ctx, source), nil
}

// Check refreshes the access token, to tell whether the grant still works.
func (a *Auth) Check(ctx context.Context) error {
	source, err := a.tokenSource(ctx)
	if err != nil {
		return err
	}
	_, err = source.Token()
	return Err(err)
}

func (a *Auth) tokenSource(ctx context.Context) (oauth2.TokenSource, error) {
	refresh, err := a.tokens.Get(ctx)
	if err != nil {
		return nil, err
	}
	if refresh == "" {
		return nil, ErrNotConnected
	}

	a.mu.Lock()
	defer a.mu.Unlock()
	if a.source == nil || a.refresh != refresh {
		// Background: the source outlives this request in a warm Lambda.
		a.source = a.config.TokenSource(context.Background(), &oauth2.Token{RefreshToken: refresh})
		a.refresh = refresh
	}
	return a.source, nil
}

// Err turns Google's "invalid_grant" (the grant was revoked, or expired)
// into ErrRevoked, so the app can ask her to reconnect. Other errors pass
// through unchanged.
func Err(err error) error {
	var retrieve *oauth2.RetrieveError
	if errors.As(err, &retrieve) && retrieve.ErrorCode == "invalid_grant" {
		return ErrRevoked
	}
	return err
}

// emailFrom reads the email claim of an ID token. It came straight from
// Google's token endpoint over TLS, so it is not verified again.
func emailFrom(idToken string) string {
	parts := strings.Split(idToken, ".")
	if len(parts) != 3 {
		return ""
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return ""
	}
	var claims struct {
		Email string `json:"email"`
	}
	if err := json.Unmarshal(payload, &claims); err != nil {
		return ""
	}
	return claims.Email
}

// Wrap names the failed operation, keeping ErrRevoked recognisable to the
// router. A nil error stays nil.
func Wrap(op string, err error) error {
	if err == nil {
		return nil
	}
	return fmt.Errorf("%s: %w", op, Err(err))
}
