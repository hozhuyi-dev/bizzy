/**
 * Two bases: "received" is money in the month it was paid (packages when
 * bought, which is what matters for tax); "earned" values sessions as they
 * happen.
 */
export type Basis = "received" | "earned";

export interface MonthPoint {
  month: string;
  cents: number;
  /** The same month a year earlier, for comparison. */
  lastYearCents: number;
  sessions: number;
  homeSessions: number;
  /** Earned per session delivered, whatever the basis. */
  avgCents: number | undefined;
  activeClients: number;
  newClients: number;
}

/** One month summed over every client. */
export interface MonthTotal {
  received: number;
  earned: number;
  sessions: number;
  homeSessions: number;
  homeEarned: number;
  active: number;
  new: number;
}

export interface YearPoint {
  year: string;
  cents: number;
  sessions: number;
}

export interface PeriodSummary {
  cents: number;
  sessions: number;
  homeSessions: number;
  homeCents: number;
}

export interface ClientShare {
  id: string;
  name: string;
  cents: number;
  /** Of the period's total, 0–1. */
  share: number;
}
