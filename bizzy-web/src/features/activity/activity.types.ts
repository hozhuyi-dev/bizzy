// Mirrors bizzy-lambda/internal/features/activity.

/** One client's sessions and money in a month; mirrors activity.Month. */
export interface MonthActivity {
  sessions: number;
  homeSessions?: number;
  /** Money paid that month, as the receipts say. */
  receivedCents: number;
  /** The sessions that happened that month, confirmed; what package credits pay of one at its share of the package. */
  earnedCents: number;
  homeEarnedCents?: number;
}

/** One client's activity, worked out when asked for; mirrors activity.View. */
export interface ActivityView {
  clientId: string;
  /** Keyed by month ("2026-10"), in the user's time zone. */
  months: Record<string, MonthActivity>;
  lastSessionAt?: string;
  nextBookedAt?: string;
}
