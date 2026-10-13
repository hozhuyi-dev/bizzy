package sessions

import (
	"context"
	"testing"
	"time"
)

// fakeStore holds one session and its notes.
type fakeStore struct {
	store
	session Session
	notes   Notes
}

func (f *fakeStore) Get(context.Context, string) (Session, bool, error) { return f.session, true, nil }

func (f *fakeStore) Save(_ context.Context, s Session) (Session, error) {
	s.Version++
	f.session = s
	return s, nil
}

func (f *fakeStore) SaveNotes(_ context.Context, n Notes) error {
	f.notes = n
	return nil
}

func TestSummaryAloneKeepsTheNotes(t *testing.T) {
	ctx := context.Background()
	f := &fakeStore{session: happened()}
	h := handler{repo: f, now: func() time.Time { return now }}
	text := "Long notes"

	if _, err := h.saveRecord(ctx, saveRecordInput{EventID: "e", Notes: &text}); err != nil {
		t.Fatal(err)
	}
	if r := f.session.Record; r == nil || !r.HasNotes || r.Summary != "" {
		t.Fatalf("record = %+v, want notes without a summary", r)
	}

	// From the to-do list: the summary only.
	if _, err := h.saveRecord(ctx, saveRecordInput{EventID: "e", Summary: "Knee mobilisation"}); err != nil {
		t.Fatal(err)
	}
	if r := f.session.Record; r.Summary != "Knee mobilisation" || !r.HasNotes || f.notes.Text != text {
		t.Errorf("record = %+v notes %q, want the summary added and the notes kept", r, f.notes.Text)
	}
}
