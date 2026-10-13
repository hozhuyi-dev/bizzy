// Package googleconnect is her Google connection, made once in Settings: which
// account, and which of its calendars the sync reads. The grant itself
// (the refresh token) is kept by googleauth.
package googleconnect

import (
	"time"
)

// Connection is the connected account and the calendar she chose.
type Connection struct {
	Email        string    `json:"email" dynamodbav:"email"`
	CalendarID   string    `json:"calendarId" dynamodbav:"calendarId"`
	CalendarName string    `json:"calendarName" dynamodbav:"calendarName"`
	ConnectedAt  time.Time `json:"connectedAt" dynamodbav:"connectedAt"`
}
