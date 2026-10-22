package settings

import (
	"context"
	"log/slog"

	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/platform/router"
	"bizzy-lambda/internal/platform/txn"
)

// View is the settings as the app shows and sends them back, defaults
// filled in. Every field is the user's to edit, so it has the entity's
// fields; View(s) only compiles while they match, so a change to what is
// stored is a deliberate change to the API.
type View struct {
	BusinessName      string   `json:"businessName"`
	RegistrationNo    string   `json:"registrationNo"`
	Address           string   `json:"address"`
	Email             string   `json:"email"`
	Phone             string   `json:"phone"`
	BankName          string   `json:"bankName,omitempty"`
	AccountName       string   `json:"accountName,omitempty"`
	AccountNo         string   `json:"accountNo,omitempty"`
	DuitNowQR         string   `json:"duitNowQr,omitempty"`
	PayPhone          string   `json:"payPhone,omitempty"`
	PayApps           []PayApp `json:"payApps,omitempty"`
	ServiceName       string   `json:"serviceName"`
	ConfirmAheadDays  int      `json:"confirmAheadDays"`
	FollowUpAheadDays int      `json:"followUpAheadDays"`
	PaymentMessage    string   `json:"paymentMessage"`
	DocumentMessage   string   `json:"documentMessage"`
}

// GapsView is what Settings still needs before documents and messages
// have all they use (Gaps), for the app to ask for; empty once they are set.
type GapsView struct {
	Missing []string `json:"missing"`
}

// GapsOf is what Settings still needs.
func GapsOf(tx *txn.Tx) (GapsView, error) {
	s, err := Get(tx)
	return GapsView{Missing: Gaps(s)}, err
}

// Routes registers the settings' actions. Saving publishes the payment
// page to site.
func Routes(r *router.Router, run *txn.Runner, site PaySite) {
	r.Query("settings.get", router.Typed(func(ctx context.Context, _ struct{}) (any, error) {
		return txn.Read(ctx, run, func(tx *txn.Tx) (View, error) {
			s, err := Get(tx)
			return View(s), err
		})
	}))
	r.Mutation("settings.save", router.Typed(func(ctx context.Context, in View) (any, error) {
		v, err := txn.Run(ctx, run, func(tx *txn.Tx) (View, error) {
			s, err := Save(tx, Settings(in))
			return View(s), err
		})
		if err != nil || site.Store == nil {
			return v, err
		}
		// Every save, so saving again mends a page a failed write left
		// behind; the page is a few small files.
		if err := site.Publish(ctx, Settings(v)); err != nil {
			slog.ErrorContext(ctx, "publish the payment page", "error", err)
			return nil, apperr.Conflict("Your settings are saved, but the payment page didn't update. Save again to retry.")
		}
		return v, nil
	}))
}
