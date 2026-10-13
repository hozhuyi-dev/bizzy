package sessions

import (
	"testing"

	"bizzy-lambda/internal/shared/money"
)

func TestKeysFollowTheIndexes(t *testing.T) {
	s := happened()
	rec := toRecord(s)
	if rec.PK != "SESSION" || rec.SK != "e" || rec.LSI2SK != "jane#"+rec.LSI1SK || rec.LSI3SK == "" || rec.LSI4SK != "priced#"+rec.LSI1SK {
		t.Errorf("keys = %+v", rec.Keys)
	}
	s.Record = &Record{Summary: "x"}
	s.Payment = &money.Payment{Status: money.Paid, AmountCents: s.DueCents(), DueCents: s.DueCents()}
	if toRecord(s).LSI3SK != "" {
		t.Error("a settled session must leave the to-do index")
	}
}
