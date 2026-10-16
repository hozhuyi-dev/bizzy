package settings

import (
	"strings"

	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/platform/txn"
)

// Save replaces the settings with what the user filled in.
func Save(tx *txn.Tx, in Settings) (Settings, error) {
	s := Settings{
		BusinessName: strings.TrimSpace(in.BusinessName), RegistrationNo: strings.TrimSpace(in.RegistrationNo),
		Address: strings.TrimSpace(in.Address), Email: strings.TrimSpace(in.Email), Phone: strings.TrimSpace(in.Phone),
		BankName: strings.TrimSpace(in.BankName), AccountName: strings.TrimSpace(in.AccountName), AccountNo: strings.TrimSpace(in.AccountNo),
		ServiceName:      strings.TrimSpace(in.ServiceName),
		ConfirmAheadDays: in.ConfirmAheadDays, FollowUpAheadDays: in.FollowUpAheadDays,
		PaymentMessage: strings.TrimSpace(in.PaymentMessage), DocumentMessage: strings.TrimSpace(in.DocumentMessage),
	}
	if err := checkAhead(s); err != nil {
		return Settings{}, err
	}
	was, ok, err := Store.Find(tx, settingsID)
	switch {
	case err != nil:
		return Settings{}, err
	case ok:
		*was = s
	default:
		err = Store.Add(tx, &s)
	}
	return s.WithDefaults(), err
}

func checkAhead(s Settings) error {
	if s.ConfirmAheadDays < 0 || s.ConfirmAheadDays > MaxAheadDays || s.FollowUpAheadDays < 0 || s.FollowUpAheadDays > MaxAheadDays {
		return apperr.Invalid("The to-do list looks at most %d days ahead.", MaxAheadDays)
	}
	return nil
}
