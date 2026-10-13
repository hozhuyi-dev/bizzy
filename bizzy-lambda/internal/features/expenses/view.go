package expenses

// View is an expense as the API returns it.
type View struct {
	Expense
	TotalCents int64 `json:"totalCents"`
	State      State `json:"state"`
}

func (e Expense) View() View {
	return View{Expense: e, TotalCents: e.TotalCents(), State: e.State()}
}

func Views(all []Expense) []View {
	out := make([]View, len(all))
	for i, e := range all {
		out[i] = e.View()
	}
	return out
}
