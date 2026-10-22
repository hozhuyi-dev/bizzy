// Package settings is the business details printed on every document, and
// the few choices that tune the to-do list and the messages the app sends.
package settings

import (
	"strings"

	"bizzy-lambda/internal/platform/txn"
)

// Settings is one item.
type Settings struct {
	BusinessName string `json:"businessName"`
	// RegistrationNo is the SSM business registration number.
	RegistrationNo string `json:"registrationNo"`
	Address        string `json:"address"`
	Email          string `json:"email"`
	Phone          string `json:"phone"`
	// Bank details are optional: receipts confirm a payment already made.
	BankName    string `json:"bankName,omitempty"`
	AccountName string `json:"accountName,omitempty"`
	AccountNo   string `json:"accountNo,omitempty"`
	// DuitNowQR is what the user's DuitNow QR says (an EMVCo payload, read
	// from the image in the browser); the payment page draws it again.
	DuitNowQR string `json:"duitNowQr,omitempty"`
	// PayPhone is the number clients pay to with PayApps; blank is Phone.
	PayPhone string   `json:"payPhone,omitempty"`
	PayApps  []PayApp `json:"payApps,omitempty"`

	// ServiceName describes a session on an invoice or receipt line.
	ServiceName string `json:"serviceName"`
	// ConfirmAheadDays is how many days ahead an unconfirmed session goes
	// on the to-do list; FollowUpAheadDays the same for a follow-up.
	ConfirmAheadDays  int `json:"confirmAheadDays"`
	FollowUpAheadDays int `json:"followUpAheadDays"`
	// PaymentMessage and DocumentMessage are the messages the app sends:
	// asking to pay, and links to issued documents. The app fills in the
	// {placeholders}.
	PaymentMessage  string `json:"paymentMessage"`
	DocumentMessage string `json:"documentMessage"`
}

const (
	DefaultServiceName       = "Physiotherapy session"
	DefaultConfirmAheadDays  = 2
	DefaultFollowUpAheadDays = 7
	// MaxAheadDays bounds both: the to-do list reads that far ahead.
	MaxAheadDays = 30

	DefaultPaymentMessage = "Hi {firstName}, the payment for {item} is {amount}.\n\n" +
		"Pay by DuitNow QR, bank transfer, TnG or GrabPay here:\n{payLink}\n\n" +
		"Or transfer to:\n{bank}\nReference: {ref}\n\nThank you!"
	DefaultDocumentMessage = "Hi {firstName}, here's your {title} from {business}:\n\n{documents}\n\nThank you!"
)

const settingsID = "BUSINESS"

// Store is the settings' one item.
var Store = txn.Kind[Settings]{
	Name: "SETTINGS", Gone: "Nothing is set yet.",
	Doc:   txn.Doc{What: "The business details and preferences: one item, BUSINESS."},
	Meta:  func(*Settings) txn.Meta { return txn.Meta{ID: settingsID} },
	Whole: true,
}

// Get is the settings, with what isn't set yet at its default.
func Get(tx *txn.Tx) (Settings, error) {
	s, ok, err := Store.Find(tx, settingsID)
	if err != nil || !ok {
		return Settings{}.WithDefaults(), err
	}
	return s.WithDefaults(), nil
}

// Gaps are the business details not set yet that documents and messages
// need, as the app asks for them: who issues an invoice or receipt (name
// and SSM number) and how to reach them (phone and email), and the bank
// details a WhatsApp message asking to pay sends ({bank}), all three or
// it is no use. The address is optional.
func Gaps(s Settings) []string {
	blank := func(v string) bool { return strings.TrimSpace(v) == "" }
	gaps := []string{}
	for _, need := range []struct {
		value, gap string
	}{
		{s.BusinessName, "your business name"},
		{s.RegistrationNo, "your SSM number"},
		{s.Phone, "your phone number"},
		{s.Email, "your email"},
	} {
		if blank(need.value) {
			gaps = append(gaps, need.gap)
		}
	}
	if blank(s.BankName) || blank(s.AccountName) || blank(s.AccountNo) {
		gaps = append(gaps, "your bank details")
	}
	return gaps
}

// WithDefaults fills in what isn't set yet.
func (s Settings) WithDefaults() Settings {
	if s.ServiceName == "" {
		s.ServiceName = DefaultServiceName
	}
	if s.PaymentMessage == "" {
		s.PaymentMessage = DefaultPaymentMessage
	}
	if s.DocumentMessage == "" {
		s.DocumentMessage = DefaultDocumentMessage
	}
	if s.ConfirmAheadDays == 0 {
		s.ConfirmAheadDays = DefaultConfirmAheadDays
	}
	if s.FollowUpAheadDays == 0 {
		s.FollowUpAheadDays = DefaultFollowUpAheadDays
	}
	return s
}
