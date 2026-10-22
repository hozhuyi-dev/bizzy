package settings

import (
	"fmt"
	"strings"
	"testing"
)

// emv is a payload of tag/value pairs, its CRC added.
func emv(pairs ...string) string {
	var b strings.Builder
	for i := 0; i < len(pairs); i += 2 {
		fmt.Fprintf(&b, "%s%02d%s", pairs[i], len(pairs[i+1]), pairs[i+1])
	}
	b.WriteString("6304")
	return b.String() + fmt.Sprintf("%04X", crc16(b.String()))
}

// sampleQR is a static DuitNow QR as a bank app gives one (made up).
var sampleQR = emv(
	"00", "01", "01", "11",
	"26", "0014A00000061500010106890053021000001234560503000",
	"52", "8099", "53", "458", "58", "MY", "59", "PHYSIO CO", "60", "KUALA LUMPUR",
)

func TestCRC16(t *testing.T) {
	// CRC-16/CCITT-FALSE's check value.
	if got := crc16("123456789"); got != 0x29B1 {
		t.Fatalf("crc16 = %04X; want 29B1", got)
	}
}

func TestCheckDuitNowQR(t *testing.T) {
	broken := sampleQR[:len(sampleQR)-4] + "0000"
	for name, c := range map[string]struct {
		payload string
		want    string // in the refusal; "" passes
	}{
		"a static DuitNow QR": {sampleQR, ""},
		"checksum in lower case": {
			sampleQR[:len(sampleQR)-4] + strings.ToLower(sampleQR[len(sampleQR)-4:]), "",
		},
		"wrong checksum":  {broken, "checksum is wrong"},
		"no checksum":     {"000201010211", "no checksum"},
		"not fields":      {"https://example.com/pay", "isn't made of fields"},
		"cut short":       {sampleQR[:20], "past the end"},
		"another country": {emv("00", "01", "26", "0002AB", "58", "SG"), "isn't from a Malaysian"},
		"no account":      {emv("00", "01", "58", "MY"), "names no account"},
		"for one amount":  {emv("00", "01", "01", "12", "26", "0002AB", "54", "95.00", "58", "MY"), "set amount"},
		"not EMVCo":       {emv("01", "11", "26", "0002AB", "58", "MY"), "doesn't start"},
		"far too long":    {strings.Repeat("0", maxDuitNowQR+1), "too long"},
	} {
		err := CheckDuitNowQR(c.payload)
		switch {
		case c.want == "" && err != nil:
			t.Errorf("%s: refused: %v", name, err)
		case c.want != "" && (err == nil || !strings.Contains(err.Error(), c.want)):
			t.Errorf("%s: got %v; want a refusal saying %q", name, err, c.want)
		}
	}
}
