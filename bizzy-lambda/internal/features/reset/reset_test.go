package reset

import "testing"

func TestAllowed(t *testing.T) {
	for env, want := range map[string]bool{
		"development": true,
		"staging":     true,
		"production":  false,
		"":            false,
		"Production":  false,
	} {
		if got := Allowed(env); got != want {
			t.Errorf("Allowed(%q) = %v, want %v", env, got, want)
		}
	}
}
