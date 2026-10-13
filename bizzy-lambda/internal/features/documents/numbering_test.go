package documents

import (
	"testing"
	"time"
)

func TestNumbering(t *testing.T) {
	if got := Number(Types[TypeReceipt], 2026, 42); got != "RCP260042" {
		t.Errorf("Number = %q, want RCP260042", got)
	}
	if got := Number(Types[TypeInvoice], 2031, 1234); got != "INV311234" {
		t.Errorf("Number = %q, want INV311234", got)
	}
	if got := Label("RCP260042", 0); got != "RCP260042-00" {
		t.Errorf("Label = %q", got)
	}
	issued := time.Date(2027, 1, 2, 0, 0, 0, 0, time.UTC)
	if got := counterKey(TypeInvoice, issued); got != "invoice#2027" {
		t.Errorf("counterKey = %q", got)
	}
}
