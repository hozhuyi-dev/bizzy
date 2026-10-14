package documents

import "testing"

// Legal says what a revision may not change: everything with legal weight
// stays as issued, and everything else may be corrected.
func TestLegal(t *testing.T) {
	src := &Source{Kind: SourceSession, ID: "s1"}
	issued := Content{
		Date: "2026-10-12", Issuer: Issuer{Name: "Physio Co", RegistrationNo: "123"},
		Recipient: Recipient{Name: "Jane Smith"}, TotalCents: 9500,
		Lines: []Line{{ID: "l1", Description: "Physiotherapy", Date: "2026-10-12", AmountCents: 9500, Source: src}},
	}
	cases := []struct {
		name   string
		change func(c *Content)
		want   string
	}{
		{"a typo in the name", func(c *Content) { c.Recipient.Name = "Jane Smyth" }, ""},
		{"a description", func(c *Content) { c.Lines[0].Description = "Physio, knee" }, ""},
		{"a service date", func(c *Content) { c.Lines[0].Date = "2026-10-13" }, ""},
		{"notes", func(c *Content) { c.Notes = "Thanks" }, ""},
		{"the date", func(c *Content) { c.Date = "2026-10-13" }, "its date"},
		{"the issuer", func(c *Content) { c.Issuer.RegistrationNo = "456" }, "the business that issued it"},
		{"an amount", func(c *Content) { c.Lines[0].AmountCents, c.TotalCents = 5000, 5000 }, "its total"},
		{"what a line covers", func(c *Content) { c.Lines[0].Source = &Source{Kind: SourceSession, ID: "s2"} }, `what line "Physiotherapy" covers`},
		{"a line", func(c *Content) { c.Lines = append(c.Lines, Line{ID: "l2"}) }, "its lines"},
		{"the payment", func(c *Content) { c.Payment = &Payment{Method: "cash", PaidOn: "2026-10-12"} }, "how and when it was paid"},
	}
	for _, c := range cases {
		revision := issued
		revision.Lines = append([]Line(nil), issued.Lines...)
		c.change(&revision)
		if got := Legal(issued, revision); got != c.want {
			t.Errorf("%s: Legal = %q, want %q", c.name, got, c.want)
		}
	}
}
