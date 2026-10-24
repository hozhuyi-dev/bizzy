package snapshot

import (
	"context"
	"strings"
	"testing"

	"bizzy-lambda/internal/features/clients"
	"bizzy-lambda/internal/platform/table"
	"bizzy-lambda/internal/platform/txn"
	"bizzy-lambda/internal/testutil/testapp"
)

var scrub = Scrub{Phone: "019-999 0000", Email: "owner@clinic.my"}

func TestPhonesFound(t *testing.T) {
	for _, text := range []string{
		"012-345 6789", "0123456789", "011-2345 6789", "03-1234 5678", "082-123456",
		"+60 12-345 6789", "+6012-3456789", "6012 345 6789", "+65 9123 4567",
		"call 012-3456789.", `line one\n0123456789`, "(012-345 6789)",
	} {
		if got := phones(text); len(got) != 1 {
			t.Errorf("%q: found %q, want one number", text, got)
		}
	}
}

func TestPhonesNotFound(t *testing.T) {
	for _, text := range []string{
		"900101-14-5678", "050101-14-5678", "600101-14-5678", // MyKad numbers
		"2026-10-24T01:00:00Z", "2026-10-24", "10:00-11:00",
		"a3f90123456789bc", "0123456789012345", "people/c0123456789", "INV-0123456789",
		"RM 1,200", "1729700000000000000", "0123456789.5",
	} {
		if got := phones(text); len(got) != 0 {
			t.Errorf("%q: found %q, want none", text, got)
		}
	}
}

func TestEmailFor(t *testing.T) {
	a, b := scrub.EmailFor("Jane@Example.com"), scrub.EmailFor("jane@example.com ")
	if a != b || !strings.HasPrefix(a, "owner+bizzy-") || !strings.HasSuffix(a, "@clinic.my") {
		t.Errorf("EmailFor: %q and %q, want one owner+bizzy-…@clinic.my", a, b)
	}
	if !scrub.own(a) || scrub.own("jane@example.com") {
		t.Errorf("own: an EmailFor address is the business's, a client's isn't")
	}
	tagged := Scrub{Email: "owner+work@clinic.my"}.EmailFor("x@y.com")
	if !strings.HasPrefix(tagged, "owner+work-bizzy-") {
		t.Errorf("EmailFor on a tagged address: %q", tagged)
	}
}

func TestText(t *testing.T) {
	items := []table.Item{
		{Key: table.Key{PK: "SETTINGS", SK: "SETTINGS"}, Data: []byte(`{"phone":"017-111 2222","email":"owner@clinic.my","accountNo":"0198765432"}`)},
		{Key: table.Key{PK: "NOTE", SK: "1"}, Data: []byte(`{"text":"Text 012-345 6789 or jane@example.com; IC 900101-14-5678"}`)},
		{Key: table.Key{PK: "DOCUMENT", SK: "2"}, Data: []byte(`{"issuer":{"phone":"017-111 2222","email":"owner@clinic.my","accountNo":"0198765432"}}`)},
	}
	out, counts := scrub.Text(items)
	if string(out[0].Data) != string(items[0].Data) {
		t.Errorf("the settings changed: %s", out[0].Data)
	}
	note := string(out[1].Data)
	if strings.Contains(note, "012-345 6789") || strings.Contains(note, "jane@example.com") || !strings.Contains(note, scrub.Phone) || !strings.Contains(note, "900101-14-5678") {
		t.Errorf("the note scrubbed to %s", note)
	}
	if string(out[2].Data) != string(items[2].Data) {
		t.Errorf("the business's own details changed: %s", out[2].Data)
	}
	if counts["NOTE"] != 2 || len(counts) != 1 {
		t.Errorf("counts %v, want 2 in NOTE", counts)
	}
}

func TestContacts(t *testing.T) {
	a := testapp.New()
	id, err := a.Client("Jane Smith", nil)
	if err != nil {
		t.Fatal(err)
	}
	n, err := scrub.Contacts(context.Background(), a.Runner.Quiet())
	if err != nil || n != 1 {
		t.Fatalf("Contacts: %d changed, %v", n, err)
	}
	c, err := txn.Read(context.Background(), a.Runner, func(tx *txn.Tx) (*clients.Client, error) { return clients.Clients.Get(tx, id) })
	if err != nil {
		t.Fatal(err)
	}
	if c.Contact.Phone != scrub.Phone {
		t.Errorf("the contact's phone is %q", c.Contact.Phone)
	}
	if n, _ := scrub.Contacts(context.Background(), a.Runner.Quiet()); n != 0 {
		t.Errorf("a second scrub changed %d", n)
	}
}

// changing is a table a commit lands on while it is scanned, the first
// times.
type changing struct {
	*table.Memory
	times int
}

func (c *changing) Scan(ctx context.Context) ([]table.Item, error) {
	if c.times > 0 {
		c.times--
		item := table.Item{Key: table.Key{PK: "NOTE", SK: "x"}, Data: []byte(`{}`)}
		read, _ := c.Versions(ctx, txn.Commits)
		read["NOTE"] = read["NOTE"]
		if _, err := c.Commit(ctx, txn.Commits, read, []table.Write{{Put: &item}}); err != nil {
			return nil, err
		}
	}
	return c.Memory.Scan(ctx)
}

func TestTakeReadsAgainWhileChanged(t *testing.T) {
	a := testapp.New()
	if _, err := Take(context.Background(), &changing{Memory: a.Table, times: 2}, a.Blobs); err != nil {
		t.Errorf("two commits meanwhile: %v", err)
	}
	if _, err := Take(context.Background(), &changing{Memory: a.Table, times: takeAttempts}, a.Blobs); err == nil {
		t.Errorf("a table that keeps changing was taken")
	}
}
