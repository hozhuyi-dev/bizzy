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

/** One client's activity and where they stand, worked out when asked for; mirrors activity.View. */
export interface ActivityView {
  clientId: string;
  /** Keyed by month ("2026-10"), in the user's time zone. */
  months: Record<string, MonthActivity>;
  lastSessionAt?: string;
  nextBookedAt?: string;
  /** The latest session summary: what the client is being seen for, lately. */
  lastSummary?: string;
  /** Sessions that happened with no summary yet. */
  unrecorded?: number;
  /** What their invoices charge that no receipt pays. */
  owedCents?: number;
  /** What their packages have left, booked sessions taken off. */
  creditsLeftMinutes?: number;
  openFollowUps?: number;
  /** When the soonest follow-up not done is due; it may be past. */
  nextFollowUpAt?: string;
  /** The latest session that happened, or follow-up done. */
  lastContactedAt?: string;
  /** The longest of the Reconnect spans (3, 6, 12 months) they have lapsed for; unset when not lapsed. */
  lapsedMonths?: number;
}
