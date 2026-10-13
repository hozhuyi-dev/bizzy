package packages

import "testing"

func TestShares(t *testing.T) {
	p := Package{Sessions: 3, PriceCents: 25000}
	total := p.ShareCents(0) + p.ShareCents(1) + p.ShareCents(2)
	if total != 25000 {
		t.Errorf("shares add up to %d, want 25000", total)
	}
}
