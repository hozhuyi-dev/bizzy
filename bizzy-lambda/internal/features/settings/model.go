// Package settings holds the business details printed on every invoice.
package settings

// Settings is a single item.
//
// DynamoDB: PK = "SETTINGS", SK = "BUSINESS".
type Settings struct {
	BusinessName string `json:"businessName" dynamodbav:"businessName"`
	// RegistrationNo is the SSM business registration number.
	RegistrationNo string `json:"registrationNo" dynamodbav:"registrationNo"`
	Address        string `json:"address" dynamodbav:"address"`
	Email          string `json:"email" dynamodbav:"email"`
	Phone          string `json:"phone" dynamodbav:"phone"`
	BankName       string `json:"bankName" dynamodbav:"bankName"`
	AccountName    string `json:"accountName" dynamodbav:"accountName"`
	AccountNo      string `json:"accountNo" dynamodbav:"accountNo"`
}
