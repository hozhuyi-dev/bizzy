package google

import "time"

// Connection is the connected account and the calendar she chose.
type Connection struct {
	Email        string    `json:"email" dynamodbav:"email"`
	CalendarID   string    `json:"calendarId" dynamodbav:"calendarId"`
	CalendarName string    `json:"calendarName" dynamodbav:"calendarName"`
	ConnectedAt  time.Time `json:"connectedAt" dynamodbav:"connectedAt"`
}
