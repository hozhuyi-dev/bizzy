package clients

// View is a client as the API returns it.
type View struct {
	Client
	// FeeTodayCents is the fee a session without an amount would be charged
	// today; nil when no fee is set.
	FeeTodayCents *int64 `json:"feeTodayCents,omitempty"`
}

// View is the client as of a local day (YYYY-MM-DD).
func (c Client) View(today string) View {
	return View{Client: c, FeeTodayCents: c.FeeOn(today)}
}
