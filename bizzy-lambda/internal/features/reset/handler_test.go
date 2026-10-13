package reset

import (
	"context"
	"errors"
	"slices"
	"strings"
	"testing"
)

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

// table is the items in each partition.
type table map[string]int

func (t table) DeleteAll(_ context.Context, keep ...string) (int, error) {
	deleted := 0
	for pk, n := range t {
		if !slices.Contains(keep, pk) {
			deleted += n
			delete(t, pk)
		}
	}
	return deleted, nil
}

func TestRunKeepsGoogleAndSyncsEverythingBack(t *testing.T) {
	data := table{"GOOGLE": 1, "SESSION": 5, "PACKAGE": 2, "CLIENT": 2, "COUNTER": 1, "SETTINGS": 1}
	synced := false
	sync := func(context.Context) (any, error) {
		if len(data) != 1 {
			t.Errorf("synced before the wipe finished: %v", data)
		}
		synced = true
		return "summary", nil
	}

	out, err := Run(context.Background(), data, sync, "GOOGLE")
	if err != nil {
		t.Fatal(err)
	}
	if got := out.(result); got.Deleted != 11 || got.Synced != "summary" || got.SyncError != "" {
		t.Errorf("result = %+v", got)
	}
	if _, kept := data["GOOGLE"]; !kept || len(data) != 1 || !synced {
		t.Errorf("left %v, synced %v", data, synced)
	}
}

func TestRunReportsAFailedSync(t *testing.T) {
	out, err := Run(context.Background(), table{"SESSION": 1}, func(context.Context) (any, error) {
		return nil, errors.New("google disconnected")
	})
	if err != nil {
		t.Fatalf("a failed sync still resets: %v", err)
	}
	if got := out.(result); got.Deleted != 1 || got.SyncError == "" {
		t.Errorf("result = %+v", got)
	}
}

type files []string

func (f *files) DeletePrefix(_ context.Context, prefix string) (int, error) {
	kept := (*f)[:0]
	for _, key := range *f {
		if !strings.HasPrefix(key, prefix) {
			kept = append(kept, key)
		}
	}
	deleted := len(*f) - len(kept)
	*f = kept
	return deleted, nil
}

func TestWipeDeletesTheFilesToo(t *testing.T) {
	data := table{"GOOGLE": 1, "SESSION": 2, "ATTACHMENT": 2}
	f := &files{"attachments/session/e1/a1/original.jpg", "attachments/session/e1/a2/original.pdf"}
	deleted, err := Wipe{Table: data, Files: f, FilesPrefix: "attachments/"}.DeleteAll(context.Background(), "GOOGLE")
	if err != nil || deleted != 6 || len(*f) != 0 || len(data) != 1 {
		t.Errorf("deleted %d (err %v), files left %v, table left %v; want 6, none, GOOGLE", deleted, err, *f, data)
	}
}
