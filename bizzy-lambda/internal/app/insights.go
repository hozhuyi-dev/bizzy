package app

import (
	"context"
	"fmt"
	"slices"
	"strconv"
	"time"

	"bizzy-lambda/internal/features/activity"
	"bizzy-lambda/internal/features/expenses"
	"bizzy-lambda/internal/platform/apperr"
	"bizzy-lambda/internal/platform/router"
	"bizzy-lambda/internal/platform/txn"
)

// InsightsView is a year of the business at a glance (insights.year): the
// calendar year, which is Malaysia's tax year. Money is as received, the
// way the tax return counts it; what prepaid packages still owe in
// sessions is shown beside it.
type InsightsView struct {
	Year int `json:"year"`
	// Years are those with money or sessions, and this one, latest first.
	Years []int `json:"years"`
	// Months are January to December, or to this month for this year.
	Months []InsightsMonth `json:"months"`
	// PreviousReceivedCents is what was received over the same months a
	// year earlier.
	PreviousReceivedCents int64 `json:"previousReceivedCents"`
	// SpentByCategory is the year's expenses by category id.
	SpentByCategory map[string]int64 `json:"spentByCategory"`
	// PrepaidMinutes and PrepaidCents are what packages have left now,
	// booked sessions taken off, and what that is worth.
	PrepaidMinutes int   `json:"prepaidMinutes"`
	PrepaidCents   int64 `json:"prepaidCents"`
}

// InsightsMonth is one month: money in and out, and sessions.
type InsightsMonth struct {
	Month         string `json:"month"`
	ReceivedCents int64  `json:"receivedCents"`
	SpentCents    int64  `json:"spentCents"`
	Sessions      int    `json:"sessions"`
	// NewSessions are those of clients in the month of their first session.
	NewSessions int `json:"newSessions"`
}

type yearRequest struct {
	Year int `json:"year"`
}

func insightsRoutes(r *router.Router, run *txn.Runner) {
	r.Query("insights.year", router.Typed(func(ctx context.Context, in yearRequest) (any, error) {
		return txn.Read(ctx, run, func(tx *txn.Tx) (InsightsView, error) {
			now := tx.Now().In(tx.Location())
			if in.Year < 2000 || in.Year > now.Year() {
				return InsightsView{}, apperr.Invalid("Choose a year up to this one.")
			}
			clients, err := activity.All(tx)
			if err != nil {
				return InsightsView{}, err
			}
			from := time.Date(in.Year, time.January, 1, 0, 0, 0, 0, time.UTC)
			spent, err := expenses.SpentBetween(tx, from, from.AddDate(1, 0, -1))
			if err != nil {
				return InsightsView{}, err
			}
			return insightsOf(clients, spent, in.Year, now), nil
		})
	}))
}

// insightsOf sums every client's activity and the year's spending into a
// year's insights, as of now.
func insightsOf(clients []activity.Client, spent expenses.Spending, year int, now time.Time) InsightsView {
	last := 12
	if year == now.Year() {
		last = int(now.Month())
	}
	month := func(y, m int) string { return fmt.Sprintf("%04d-%02d", y, m) }
	v := InsightsView{Year: year, Months: make([]InsightsMonth, last), SpentByCategory: spent.ByCategory}
	index := map[string]int{}
	for i := range v.Months {
		key := month(year, i+1)
		v.Months[i] = InsightsMonth{Month: key, SpentCents: spent.ByMonth[key]}
		index[key] = i
	}
	before := month(year-1, last)
	years := map[int]bool{now.Year(): true}
	for _, c := range clients {
		v.PrepaidMinutes += c.CreditsLeftMinutes
		v.PrepaidCents += c.CreditsLeftCents
		first := ""
		for key, m := range c.Months {
			if m.Sessions > 0 && (first == "" || key < first) {
				first = key
			}
		}
		for key, m := range c.Months {
			if m.Sessions > 0 || m.ReceivedCents > 0 {
				if y, err := strconv.Atoi(key[:4]); err == nil {
					years[y] = true
				}
			}
			if key[:4] == strconv.Itoa(year-1) && key <= before {
				v.PreviousReceivedCents += m.ReceivedCents
			}
			i, ok := index[key]
			if !ok {
				continue
			}
			v.Months[i].ReceivedCents += m.ReceivedCents
			v.Months[i].Sessions += m.Sessions
			if key == first {
				v.Months[i].NewSessions += m.Sessions
			}
		}
	}
	for y := range years {
		v.Years = append(v.Years, y)
	}
	slices.SortFunc(v.Years, func(a, b int) int { return b - a })
	return v
}
