package settings

import (
	"context"
	"encoding/json"
	"strings"

	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/router"
)

// HandlerStore is what the handlers read and write.
type HandlerStore interface {
	Get(ctx context.Context) (Settings, error)
	Put(ctx context.Context, s Settings) error
}

// AfterSave runs when the home-visit colour or the tracking date changes,
// since every session's location and to-dos depend on them.
type AfterSave func(ctx context.Context) error

type handler struct {
	repo      HandlerStore
	afterSave AfterSave
}

func Register(r *router.Router, repo HandlerStore, afterSave AfterSave) {
	h := handler{repo: repo, afterSave: afterSave}
	r.Query("settings.get", h.get)
	r.Mutation("settings.save", router.Typed(h.save))
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
		BusinessName:      strings.TrimSpace(in.BusinessName),
		RegistrationNo:    strings.TrimSpace(in.RegistrationNo),
		Address:           strings.TrimSpace(in.Address),
		Email:             strings.TrimSpace(in.Email),
		Phone:             strings.TrimSpace(in.Phone),
		BankName:          strings.TrimSpace(in.BankName),
		AccountName:       strings.TrimSpace(in.AccountName),
		AccountNo:         strings.TrimSpace(in.AccountNo),
		ServiceName:       strings.TrimSpace(in.ServiceName),
		HomeVisitColorID:  strings.TrimSpace(in.HomeVisitColorID),
		PaymentMessage:    strings.TrimSpace(in.PaymentMessage),
		DocumentMessage:   strings.TrimSpace(in.DocumentMessage),
		ConfirmAheadDays:  in.ConfirmAheadDays,
		FollowUpAheadDays: in.FollowUpAheadDays,
	}
	for _, days := range []int{s.ConfirmAheadDays, s.FollowUpAheadDays} {
		if days < 0 || days > MaxAheadDays {
			return nil, apperr.Invalid("look ahead 1 to %d days", MaxAheadDays)
		}
	}
	s = s.WithDefaults()

	if err := h.repo.Put(ctx, s); err != nil {
		return nil, err
	}
	changed := s.HomeVisitColorID != previous.HomeVisitColorID
	if changed && h.afterSave != nil {
		if err := h.afterSave(ctx); err != nil {
			return nil, err
		}
	}
	return s, nil
}
