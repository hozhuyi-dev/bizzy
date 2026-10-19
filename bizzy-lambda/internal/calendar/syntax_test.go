package calendar

import (
	"errors"
	"testing"
)

func cents(v int64) *int64 { return &v }

func TestParseTitle(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  Title
	}{
		{
			name:  "name only uses client default",
			input: "Jane Smith",
			want:  Title{Name: "Jane Smith"},
		},
		{
			name:  "name and amount",
			input: "Jane Smith 95",
			want:  Title{Name: "Jane Smith", FeeCents: cents(9500)},
		},
		{
			name:  "decimal amount",
			input: "Jane Smith 95.5",
			want:  Title{Name: "Jane Smith", FeeCents: cents(9550)},
		},
		{
			name:  "RM prefix tolerated",
			input: "Jane Smith RM95.25",
			want:  Title{Name: "Jane Smith", FeeCents: cents(9525)},
		},
		{
			name:  "RM prefix on a package price",
			input: "Jane Smith 10xrm85",
			want:  Title{Name: "Jane Smith", Package: &PackageSpec{Hours: 10, PriceCents: 85000}},
		},
		{
			name:  "tentative",
			input: "? Jane Smith",
			want:  Title{Tentative: true, Name: "Jane Smith"},
		},
		{
			name:  "tentative without space",
			input: "?Jane Smith 95",
			want:  Title{Tentative: true, Name: "Jane Smith", FeeCents: cents(9500)},
		},
		{
			name:  "package at a price per hour",
			input: "Jane Smith 10x85",
			want:  Title{Name: "Jane Smith", Package: &PackageSpec{Hours: 10, PriceCents: 85000}},
		},
		{
			name:  "uppercase X",
			input: "Jane Smith 10X85.50",
			want:  Title{Name: "Jane Smith", Package: &PackageSpec{Hours: 10, PriceCents: 85500}},
		},
		{
			name:  "package at a total price",
			input: "Jane Smith 3@250",
			want:  Title{Name: "Jane Smith", Package: &PackageSpec{Hours: 3, PriceCents: 25000}},
		},
		{
			name:  "RM prefix on a package total",
			input: "Jane Smith 10@RM1000",
			want:  Title{Name: "Jane Smith", Package: &PackageSpec{Hours: 10, PriceCents: 100000}},
		},
		{
			name:  "paid session plus package for later",
			input: "Jane Smith 95 10x85",
			want:  Title{Name: "Jane Smith", FeeCents: cents(9500), Package: &PackageSpec{Hours: 10, PriceCents: 85000}},
		},
		{
			name:  "package then amount, either order",
			input: "Jane Smith 10@850 95",
			want:  Title{Name: "Jane Smith", FeeCents: cents(9500), Package: &PackageSpec{Hours: 10, PriceCents: 85000}},
		},
		{
			name:  "extra whitespace",
			input: "  ?   Jane    Smith   95  ",
			want:  Title{Tentative: true, Name: "Jane Smith", FeeCents: cents(9500)},
		},
		{
			name:  "unknown name still parses",
			input: "Dentist",
			want:  Title{Name: "Dentist"},
		},
		{
			name:  "a home visit",
			input: "Jane Smith (V)",
			want:  Title{Name: "Jane Smith", Place: PlaceVisit},
		},
		{
			name:  "her place, lowercase, among the other tokens",
			input: "? Jane Smith 95 (h) 10x85",
			want:  Title{Tentative: true, Name: "Jane Smith", Place: PlaceHome, FeeCents: cents(9500), Package: &PackageSpec{Hours: 10, PriceCents: 85000}},
		},
		{
			name:  "brackets inside the name are part of the name",
			input: "Jane (V) Smith",
			want:  Title{Name: "Jane (V) Smith"},
		},
		{
			name:  "number inside the name is part of the name",
			input: "Pilates 2 Jane",
			want:  Title{Name: "Pilates 2 Jane"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := ParseTitle(tt.input)
			if err != nil {
				t.Fatalf("ParseTitle(%q) error: %v", tt.input, err)
			}
			assertTitle(t, got, tt.want)
		})
	}
}

func TestParseTitleErrors(t *testing.T) {
	tests := []struct {
		name  string
		input string
	}{
		{name: "two amounts", input: "Jane Smith 95 100"},
		{name: "two packages", input: "Jane Smith 10x85 5@400"},
		{name: "zero-hour package", input: "Jane Smith 0x85"},
		{name: "zero-hour package total", input: "Jane Smith 0@850"},
		{name: "amount without name", input: "95"},
		{name: "tentative without name", input: "?"},
		{name: "empty title", input: "   "},
		{name: "two places", input: "Jane (V) (H)"},
		{name: "a place no letter means", input: "Jane (X)"},
		{name: "place without name", input: "(V)"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := ParseTitle(tt.input)
			var parseErr *ParseError
			if !errors.As(err, &parseErr) {
				t.Fatalf("ParseTitle(%q) = %v, want *ParseError", tt.input, err)
			}
		})
	}
}

func assertTitle(t *testing.T, got, want Title) {
	t.Helper()

	if got.Tentative != want.Tentative || got.Name != want.Name || got.Place != want.Place {
		t.Errorf("got {Tentative:%v Name:%q Place:%q}, want {Tentative:%v Name:%q Place:%q}",
			got.Tentative, got.Name, got.Place, want.Tentative, want.Name, want.Place)
	}

	switch {
	case (got.FeeCents == nil) != (want.FeeCents == nil):
		t.Errorf("FeeCents = %v, want %v", got.FeeCents, want.FeeCents)
	case got.FeeCents != nil && *got.FeeCents != *want.FeeCents:
		t.Errorf("FeeCents = %d, want %d", *got.FeeCents, *want.FeeCents)
	}

	switch {
	case (got.Package == nil) != (want.Package == nil):
		t.Errorf("Package = %+v, want %+v", got.Package, want.Package)
	case got.Package != nil && *got.Package != *want.Package:
		t.Errorf("Package = %+v, want %+v", *got.Package, *want.Package)
	}
}

func TestFormatTitleRoundTrips(t *testing.T) {
	tests := []struct {
		title Title
		want  string
	}{
		{Title{Name: "Jane Smith"}, "Jane Smith"},
		{Title{Name: "Jane Smith", Tentative: true}, "? Jane Smith"},
		{Title{Name: "Jane Smith", FeeCents: cents(9550)}, "Jane Smith 95.50"},
		{Title{Name: "Jane Smith", Package: &PackageSpec{Hours: 10, PriceCents: 85000}}, "Jane Smith 10x85"},
		{Title{Name: "Jane Smith", Package: &PackageSpec{Hours: 3, PriceCents: 25000}}, "Jane Smith 3@250"},
		{
			Title{Name: "Jane Smith", Tentative: true, FeeCents: cents(9500), Package: &PackageSpec{Hours: 3, PriceCents: 25001}},
			"? Jane Smith 95 3@250.01",
		},
		{Title{Name: "Jane Smith", Place: PlaceVisit, FeeCents: cents(9500)}, "Jane Smith (V) 95"},
	}
	for _, tt := range tests {
		got := FormatTitle(tt.title)
		if got != tt.want {
			t.Errorf("FormatTitle(%+v) = %q, want %q", tt.title, got, tt.want)
		}
		parsed, err := ParseTitle(got)
		if err != nil {
			t.Fatalf("ParseTitle(%q): %v", got, err)
		}
		if FormatTitle(parsed) != got {
			t.Errorf("%q parses back as %+v", got, parsed)
		}
	}
}

func TestParseFollowUp(t *testing.T) {
	tests := []struct {
		raw     string
		want    FollowUpTitle
		wantErr bool
	}{
		{"! Jane Smith: Check MRI results", FollowUpTitle{Name: "Jane Smith", Summary: "Check MRI results"}, false},
		{"!Jane  Smith", FollowUpTitle{Name: "Jane Smith"}, false},
		{"  ! Jane: call back: about knee ", FollowUpTitle{Name: "Jane", Summary: "call back: about knee"}, false},
		{"! : no name", FollowUpTitle{Summary: "no name"}, true},
		{"Jane Smith", FollowUpTitle{}, true},
	}
	for _, tt := range tests {
		got, err := ParseFollowUp(tt.raw)
		if (err != nil) != tt.wantErr || got != tt.want {
			t.Errorf("ParseFollowUp(%q) = %+v, %v; want %+v, error %v", tt.raw, got, err, tt.want, tt.wantErr)
		}
	}

	for _, title := range []FollowUpTitle{{Name: "Jane Smith", Summary: "Check MRI"}, {Name: "Jane Smith"}} {
		got, err := ParseFollowUp(FormatFollowUp(title))
		if err != nil || got != title {
			t.Errorf("round trip %+v = %+v, %v", title, got, err)
		}
	}
	if !IsFollowUp(" ! Jane") || IsFollowUp("? Jane") || IsFollowUp("Jane !") {
		t.Error("IsFollowUp misreads")
	}
}
