package settings

import (
	"context"
	"encoding/json"
	"strings"

	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/router"
)

type store interface {
	Get(ctx context.Context) (Settings, error)
	Put(ctx context.Context, s Settings) error
}

// AfterSave runs when the home-visit colour changes, since every session's
// location depends on it.
type AfterSave func(ctx context.Context) error

// ValidateNumbering checks a number template; the documents feature owns the
// format, so it is passed in rather than imported.
type ValidateNumbering func(template string) error

type handler struct {
	repo      store
	afterSave AfterSave
	validate  ValidateNumbering
}

func Register(r *router.Router, repo store, validate ValidateNumbering, afterSave AfterSave) {
	h := handler{repo: repo, afterSave: afterSave, validate: validate}
	r.Register("settings.get", h.get)
	r.Register("settings.save", router.Typed(h.save))
}

func (h handler) get(ctx context.Context, _ json.RawMessage) (any, error) {
	return h.repo.Get(ctx)
}

func (h handler) save(ctx context.Context, in Settings) (any, error) {
	previous, err := h.repo.Get(ctx)
	if err != nil {
		return nil, err
	}

	s := Settings{
		BusinessName:     strings.TrimSpace(in.BusinessName),
		RegistrationNo:   strings.TrimSpace(in.RegistrationNo),
		Address:          strings.TrimSpace(in.Address),
		Email:            strings.TrimSpace(in.Email),
		Phone:            strings.TrimSpace(in.Phone),
		BankName:         strings.TrimSpace(in.BankName),
		AccountName:      strings.TrimSpace(in.AccountName),
		AccountNo:        strings.TrimSpace(in.AccountNo),
		ServiceName:      strings.TrimSpace(in.ServiceName),
		HomeVisitColorID: strings.TrimSpace(in.HomeVisitColorID),
		Numbering:        map[string]string{},
		PaymentMessage:   strings.TrimSpace(in.PaymentMessage),
		DocumentMessage:  strings.TrimSpace(in.DocumentMessage),
	}
	for docType, template := range in.Numbering {
		template = strings.TrimSpace(template)
		if template == "" {
			continue
		}
		if err := h.validate(template); err != nil {
			return nil, apperr.Invalid("%s numbering: %v", docType, err)
		}
		s.Numbering[docType] = template
	}
	s = s.WithDefaults()

	if err := h.repo.Put(ctx, s); err != nil {
		return nil, err
	}
	if s.HomeVisitColorID != previous.HomeVisitColorID && h.afterSave != nil {
		if err := h.afterSave(ctx); err != nil {
			return nil, err
		}
	}
	return s, nil
}
