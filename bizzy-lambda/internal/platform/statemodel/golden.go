package statemodel

import (
	"flag"
	"os"
	"path/filepath"
	"testing"
)

var update = flag.Bool("update", false, "rewrite the state tables in testdata")

// CheckTable lints an entity's rules and compares its decision table with
// the golden file at path; `go test -run TestStates -update` rewrites it.
func CheckTable[S any](t *testing.T, path, title string, axes Axes[S], rules Rules[S]) {
	t.Helper()
	for _, err := range Lint(axes, rules) {
		t.Error(err)
	}
	Golden(t, path, Table(title, axes, rules))
}

// Golden compares generated Markdown with the file at path, or rewrites it
// with -update.
func Golden(t *testing.T, path, got string) {
	t.Helper()
	if *update {
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(got), 0o644); err != nil {
			t.Fatal(err)
		}
		return
	}
	want, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("%v (run with -update to create it)", err)
	}
	if string(want) != got {
		t.Errorf("%s is out of date: the axes or rules changed. Run the test with -update and review the diff.", path)
	}
}
