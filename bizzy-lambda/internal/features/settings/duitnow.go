package settings

// DuitNow QR: the QR every Malaysian bank app and e-wallet (TnG, GrabPay,
// Boost, ShopeePay, MAE) scans to pay into one account. It is an EMVCo
// merchant-presented QR: fields of a two-digit tag, a two-digit length
// and the value, ending in a CRC of everything before it. The user's is
// static (no amount), so one QR serves every payment.

import (
	"fmt"
	"strconv"
	"strings"

	"bizzy-lambda/internal/platform/apperr"
)

// maxDuitNowQR is longer than any merchant-presented payload (each field
// is at most 99 characters, and a QR holds a few hundred).
const maxDuitNowQR = 512

// CheckDuitNowQR is whether payload is a static DuitNow QR the payment
// page can show: well formed, its CRC right, Malaysian, and with no
// amount of its own (a QR for one payment can't be shown to every
// client).
func CheckDuitNowQR(payload string) error {
	notQR := func(why string) error {
		return apperr.Invalid("That isn't a DuitNow QR: %s. Upload the QR your bank or e-wallet gives you to receive money.", why)
	}
	if len(payload) > maxDuitNowQR {
		return notQR("it is too long")
	}
	fields, err := emvFields(payload)
	if err != nil {
		return notQR(err.Error())
	}
	if len(fields) == 0 || fields[0].tag != "00" || fields[0].value != "01" {
		return notQR("it doesn't start as one")
	}
	last := fields[len(fields)-1]
	if last.tag != "63" || len(last.value) != 4 {
		return notQR("it has no checksum")
	}
	if want := fmt.Sprintf("%04X", crc16(payload[:len(payload)-4])); !strings.EqualFold(last.value, want) {
		return notQR("its checksum is wrong")
	}
	byTag := map[string]string{}
	account := false
	for _, f := range fields {
		byTag[f.tag] = f.value
		// 26 to 51 are where a payment network names the account.
		if n, err := strconv.Atoi(f.tag); err == nil && n >= 26 && n <= 51 {
			account = true
		}
	}
	switch {
	case !account:
		return notQR("it names no account to pay")
	case byTag["58"] != "MY":
		return notQR("it isn't from a Malaysian bank or e-wallet")
	case byTag["54"] != "":
		return apperr.Invalid("That QR is for one payment of a set amount. Upload the QR your bank or e-wallet gives you to receive any amount.")
	}
	return nil
}

type emvField struct{ tag, value string }

// emvFields reads a payload's top-level fields, in order.
func emvFields(payload string) ([]emvField, error) {
	var out []emvField
	for rest := payload; rest != ""; {
		if len(rest) < 4 {
			return nil, fmt.Errorf("it ends partway through a field")
		}
		n, err := strconv.Atoi(rest[2:4])
		if err != nil || n < 0 || !isDigits(rest[:2]) {
			return nil, fmt.Errorf("it isn't made of fields")
		}
		if len(rest) < 4+n {
			return nil, fmt.Errorf("a field runs past the end")
		}
		out = append(out, emvField{tag: rest[:2], value: rest[4 : 4+n]})
		rest = rest[4+n:]
	}
	return out, nil
}

func isDigits(s string) bool {
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	return s != ""
}

// crc16 is CRC-16/CCITT-FALSE, the checksum EMVCo QRs end with.
func crc16(s string) uint16 {
	crc := uint16(0xFFFF)
	for i := range len(s) {
		crc ^= uint16(s[i]) << 8
		for range 8 {
			if crc&0x8000 != 0 {
				crc = crc<<1 ^ 0x1021
			} else {
				crc <<= 1
			}
		}
	}
	return crc
}
