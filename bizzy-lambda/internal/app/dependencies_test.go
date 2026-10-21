package app_test

import (
	"go/parser"
	"go/token"
	"io/fs"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"testing"
)

// features lists what each feature may import besides platform: the
// features it builds on, and calendar if it deals with Google Calendar. It
// is the map of how features depend on each other; a new feature adds its
// row, and a new edge is a deliberate change here.
var features = map[string][]string{
	"settings":      {},
	"clients":       {"calendar"},
	"contacts":      {"clients"},
	"documents":     {"clients", "settings"},
	"packages":      {"clients", "documents", "settings"},
	"attachments":   {},
	"sessions":      {"clients", "documents", "packages", "settings", "attachments"},
	"payments":      {"sessions", "packages", "documents"},
	"followups":     {"clients", "sessions", "settings"},
	"expenses":      {"attachments"},
	"conflicts":     {"calendar"},
	"todo":          {"sessions", "packages", "documents", "followups", "conflicts", "settings"},
	"activity":      {"sessions", "packages", "documents", "followups"},
	"timeline":      {"sessions", "packages", "documents", "followups"},
	"googlesync":    {"calendar", "clients", "sessions", "packages", "documents", "followups", "conflicts", "contacts"},
	"googleconnect": {"calendar"},
	"reset":         {"googlesync", "googleconnect", "attachments"},
}

// TestDependenciesPointInward checks every non-test import inside
// internal/:
//   - platform imports only platform: it knows nothing of bizzy;
//   - calendar imports only platform: it knows Google, not the features;
//   - a feature imports platform and what its row in features allows;
//   - only app, testutil and simulation import app; only simulation and
//     tests import testutil.
func TestDependenciesPointInward(t *testing.T) {
	const module = "bizzy-lambda/internal/"
	imports := map[string][]string{}
	err := filepath.WalkDir("..", func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return err
		}
		f, err := parser.ParseFile(token.NewFileSet(), path, nil, parser.ImportsOnly)
		if err != nil {
			return err
		}
		pkg := filepath.ToSlash(filepath.Dir(path))[len("../"):]
		for _, imp := range f.Imports {
			p, _ := strconv.Unquote(imp.Path.Value)
			if dep, ok := strings.CutPrefix(p, module); ok && !slices.Contains(imports[pkg], dep) {
				imports[pkg] = append(imports[pkg], dep)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}

	for pkg, deps := range imports {
		for _, dep := range deps {
			if why := forbidden(pkg, dep); why != "" {
				t.Errorf("%s imports %s: %s", pkg, dep, why)
			}
		}
	}
	for pkg := range imports {
		if name, ok := strings.CutPrefix(pkg, "features/"); ok {
			if _, listed := features[name]; !listed {
				t.Errorf("feature %s has no row in features (dependencies_test.go): say what it may import", name)
			}
		}
	}
}

// forbidden says why pkg may not import dep; "" when it may.
func forbidden(pkg, dep string) string {
	top := func(p string) string { return strings.SplitN(p, "/", 2)[0] }
	switch {
	case top(dep) == "platform" && top(pkg) != "platform" || top(pkg) == "platform" && top(dep) == "platform":
		return ""
	case top(pkg) == "platform":
		return "platform knows nothing of bizzy"
	case pkg == "calendar":
		return "calendar knows Google, not the features"
	case top(pkg) == "features":
		name := strings.TrimPrefix(pkg, "features/")
		want := strings.TrimPrefix(dep, "features/")
		if slices.Contains(features[name], want) {
			return ""
		}
		return "not in its row in features (dependencies_test.go)"
	case dep == "app" && pkg != "testutil/testapp" && top(pkg) != "simulation":
		return "only the entry points, tests and the simulation build the app"
	case top(dep) == "testutil" && top(pkg) != "testutil" && top(pkg) != "simulation":
		return "testutil is for tests"
	case top(dep) == "simulation":
		return "nothing imports the simulation"
	}
	return ""
}
