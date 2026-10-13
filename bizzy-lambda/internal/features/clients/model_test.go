package clients

import "testing"

func TestFeeOn(t *testing.T) {
	c := Client{FeeRates: []FeeRate{{Cents: 9000}, {From: "2026-10-01", Cents: 10000}}}
	for day, want := range map[string]int64{"2020-01-01": 9000, "2026-09-30": 9000, "2026-10-01": 10000, "2027-01-01": 10000} {
		if got := c.FeeOn(day); got == nil || *got != want {
			t.Errorf("FeeOn(%s) = %v, want %d", day, got, want)
		}
	}
	if got := (Client{}).FeeOn("2026-10-01"); got != nil {
		t.Errorf("no rates: FeeOn = %d, want nil", *got)
	}
}
