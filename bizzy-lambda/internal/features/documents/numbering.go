package documents

import (
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// Numbering turns a sequence number into a document number. It is the one
// place that knows the format, so matching whatever system she used before
// is a change to the template (in Settings) or to this file only.
//
// Templates use {seq} or {seq:N} (zero-padded to N digits), and optionally
// {YYYY} or {YY}. A template with a year restarts the sequence every year.
//
//	RCP-{seq:4}         RCP-0001, RCP-0002 …
//	R{YY}-{seq:3}       R26-001 … R27-001
type Numbering struct {
	Template string
}

var (
	seqToken  = regexp.MustCompile(`\{seq(?::(\d))?\}`)
	yearToken = regexp.MustCompile(`\{(YYYY|YY)\}`)
	anyToken  = regexp.MustCompile(`\{[^}]*\}`)
)

// ValidateTemplate reports a template she could not mean.
func ValidateTemplate(template string) error {
	if len(seqToken.FindAllString(template, -1)) != 1 {
		return errors.New("must contain {seq} or {seq:N} exactly once")
	}
	for _, token := range anyToken.FindAllString(template, -1) {
		if !seqToken.MatchString(token) && !yearToken.MatchString(token) {
			return fmt.Errorf("unknown placeholder %s", token)
		}
	}
	return nil
}

// Yearly reports whether the sequence restarts every year.
func (n Numbering) Yearly() bool {
	return yearToken.MatchString(n.Template)
}

// CounterKey names the counter a document issued on date draws from.
func (n Numbering) CounterKey(docType Type, date time.Time) string {
	if n.Yearly() {
		return fmt.Sprintf("%s#%d", docType, date.Year())
	}
	return string(docType)
}

func (n Numbering) Format(seq int64, date time.Time) string {
	out := seqToken.ReplaceAllStringFunc(n.Template, func(token string) string {
		width := 0
		if m := seqToken.FindStringSubmatch(token); m[1] != "" {
			width, _ = strconv.Atoi(m[1])
		}
		return fmt.Sprintf("%0*d", width, seq)
	})
	out = strings.ReplaceAll(out, "{YYYY}", strconv.Itoa(date.Year()))
	return strings.ReplaceAll(out, "{YY}", fmt.Sprintf("%02d", date.Year()%100))
}
