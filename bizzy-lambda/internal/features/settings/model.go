// Package settings holds the business details printed on every document and
// the few choices that tune the sync and billing.
package settings

// Settings is a single item.
type Settings struct {
	BusinessName string `json:"businessName" dynamodbav:"businessName"`
	// RegistrationNo is the SSM business registration number.
	RegistrationNo string `json:"registrationNo" dynamodbav:"registrationNo"`
	Address        string `json:"address" dynamodbav:"address"`
	Email          string `json:"email" dynamodbav:"email"`
	Phone          string `json:"phone" dynamodbav:"phone"`
	// Bank details are optional: receipts confirm a payment already made.
	BankName    string `json:"bankName,omitempty" dynamodbav:"bankName,omitempty"`
	AccountName string `json:"accountName,omitempty" dynamodbav:"accountName,omitempty"`
	AccountNo   string `json:"accountNo,omitempty" dynamodbav:"accountNo,omitempty"`

	// ServiceName describes a session on a receipt line.
	ServiceName string `json:"serviceName" dynamodbav:"serviceName"`
	// HomeVisitColorID is the Google Calendar event colour that marks a home
	// visit ("1" Lavender … "11" Tomato).
	HomeVisitColorID string `json:"homeVisitColorId" dynamodbav:"homeVisitColorId"`
	// Numbering maps a document type to its number template, e.g.
	// "RCP-{seq:4}". See documents/numbering.
	Numbering map[string]string `json:"numbering" dynamodbav:"numbering"`

	// PaymentMessage and DocumentMessage are the WhatsApp messages she sends
	// from a session or client: asking to pay with her bank details, and
	// links to issued documents. The app fills in the {placeholders}.
	PaymentMessage  string `json:"paymentMessage" dynamodbav:"paymentMessage"`
	DocumentMessage string `json:"documentMessage" dynamodbav:"documentMessage"`
}

const (
	DefaultServiceName      = "Physiotherapy session"
	DefaultHomeVisitColorID = "11" // Tomato

	DefaultPaymentMessage = "Hi {firstName}, thanks for coming in on {date}. The session is {amount}.\n\n" +
		"You can transfer it to:\n{bank}\n\nThank you!"
	DefaultDocumentMessage = "Hi {firstName}, here's your {title} from {business}:\n\n{documents}\n\nThank you!"
)

// WithDefaults fills in whatever she has not set yet.
func (s Settings) WithDefaults() Settings {
	if s.ServiceName == "" {
		s.ServiceName = DefaultServiceName
	}
	if s.HomeVisitColorID == "" {
		s.HomeVisitColorID = DefaultHomeVisitColorID
	}
	if s.PaymentMessage == "" {
		s.PaymentMessage = DefaultPaymentMessage
	}
	if s.DocumentMessage == "" {
		s.DocumentMessage = DefaultDocumentMessage
	}
	numbering := map[string]string{}
	for docType, template := range s.Numbering {
		if template != "" {
			numbering[docType] = template
		}
	}
	s.Numbering = numbering
	return s
}
