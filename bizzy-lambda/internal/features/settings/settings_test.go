package settings

import (
	"slices"
	"testing"
)

func TestGaps(t *testing.T) {
	full := Settings{
		BusinessName: "Physio Co", RegistrationNo: "202601234567", Phone: "012-345 6789", Email: "hi@physio.co",
		BankName: "Maybank", AccountName: "Physio Co", AccountNo: "5140 1234 5678",
	}
	without := func(change func(*Settings)) Settings {
		s := full
		change(&s)
		return s
	}
	for name, c := range map[string]struct {
		s    Settings
		want []string
	}{
		"all set, no address": {full, []string{}},
		"nothing yet": {Settings{}, []string{
			"your business name", "your SSM number", "your phone number", "your email", "your bank details",
		}},
		"blank is not set":         {without(func(s *Settings) { s.BusinessName = "  " }), []string{"your business name"}},
		"both ways to reach them":  {without(func(s *Settings) { s.Email = "" }), []string{"your email"}},
		"one bank detail missing":  {without(func(s *Settings) { s.AccountNo = "" }), []string{"your bank details"}},
		"the SSM number is needed": {without(func(s *Settings) { s.RegistrationNo = "" }), []string{"your SSM number"}},
	} {
		if got := Gaps(c.s); !slices.Equal(got, c.want) {
			t.Errorf("%s: Gaps = %q; want %q", name, got, c.want)
		}
	}
}
