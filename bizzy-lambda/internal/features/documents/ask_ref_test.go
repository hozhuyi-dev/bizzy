package documents

import "testing"

func TestRefOf(t *testing.T) {
	session := []AskLine{{Date: "2026-10-05", kind: SourceSession}}
	pkg := []AskLine{{Date: "2026-10-05", kind: SourcePackage}}
	for _, c := range []struct {
		name  string
		lines []AskLine
		want  string
	}{
		{"Aisyah binti Ahmad", session, "AISYAH 05OCT"},
		{"Aisyah binti Ahmad", pkg, "AISYAH PKG 05OCT"},
		{"Aisyah binti Ahmad", []AskLine{{Number: "INV-26-0012"}}, "INV260012"},
		// The latest day of several, a package among them or not.
		{"Aisyah", append(pkg, AskLine{Date: "2026-10-12"}), "AISYAH 12OCT"},
		// Letters, digits and spaces only, at most 20, as bank apps take them.
		{"Siti-Nur'aini Abdullah", session, "SITINURAINI 05OCT"},
		{"Muhammadabdulrahmanshah Ali", pkg, "MUHAMMADAB PKG 05OCT"},
		// A name with no Latin letters leaves the day.
		{"陈美玲", session, "05OCT"},
		// Nothing dated: today.
		{"Aisyah", []AskLine{{}}, "AISYAH 23OCT"},
	} {
		if got := refOf(c.name, c.lines, "2026-10-23"); got != c.want {
			t.Errorf("refOf(%q, %+v) = %q, want %q", c.name, c.lines, got, c.want)
		}
	}
}
