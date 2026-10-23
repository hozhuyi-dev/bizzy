// Mirrors bizzy-lambda/internal/app/insights.go.

/** One month: money in and out, and sessions; mirrors app.InsightsMonth. */
export interface InsightsMonth {
  /** "2026-10". */
  month: string;
  receivedCents: number;
  spentCents: number;
  sessions: number;
  /** Those of clients in the month of their first session. */
  newSessions: number;
}

/**
 * A calendar year (Malaysia's tax year) at a glance; mirrors
 * app.InsightsView. Money is as received, as the tax return counts it.
 */
export interface InsightsView {
  year: number;
  /** Those with money or sessions, and this one, latest first. */
  years: Array<number>;
  /** January to December, or to this month for this year. */
  months: Array<InsightsMonth>;
  /** Received over the same months a year earlier. */
  previousReceivedCents: number;
  /** The year's expenses by category id. */
  spentByCategory: Record<string, number>;
  /** What packages have left now, booked sessions taken off, and what that is worth. */
  prepaidMinutes: number;
  prepaidCents: number;
}

/** The year's totals, for the numbers at the top. */
export interface InsightsTotals {
  receivedCents: number;
  spentCents: number;
  leftCents: number;
  sessions: number;
  /** Received against the same months a year earlier, as a fraction; undefined with nothing to compare. */
  receivedChange: number | undefined;
}
