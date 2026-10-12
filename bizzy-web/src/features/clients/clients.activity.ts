import type { Client, MonthActivity } from "./clients.types";
import { addMonths, monthKey, monthsBetween } from "~/core/utils/date.util";

/**
 * Client figures summed from the per-month activity the API keeps on each
 * client. Everything here is pure, so rolling windows ("last 12 months")
 * never go stale.
 */

export interface ActivityTotals {
  sessions: number;
  homeSessions: number;
  receivedCents: number;
  earnedCents: number;
  homeEarnedCents: number;
}

const EMPTY: ActivityTotals = {
  sessions: 0,
  homeSessions: 0,
  receivedCents: 0,
  earnedCents: 0,
  homeEarnedCents: 0,
};

export function addActivity(total: ActivityTotals, month: MonthActivity): ActivityTotals {
  return {
    sessions: total.sessions + month.sessions,
    homeSessions: total.homeSessions + (month.homeSessions ?? 0),
    receivedCents: total.receivedCents + month.receivedCents,
    earnedCents: total.earnedCents + month.earnedCents,
    homeEarnedCents: total.homeEarnedCents + (month.homeEarnedCents ?? 0),
  };
}

/** Sums a client's months in [from, to] ("2026-01" … "2026-12"); open ends allowed. */
export function totals(client: Client, from?: string, to?: string): ActivityTotals {
  let total = EMPTY;
  for (const [month, activity] of Object.entries(client.activity ?? {})) {
    if ((from && month < from) || (to && month > to)) continue;
    total = addActivity(total, activity);
  }
  return total;
}

/** The last 12 months including this one. */
export function last12Months(client: Client, now = new Date()): ActivityTotals {
  const current = monthKey(now);
  return totals(client, addMonths(current, -11), current);
}

export function monthsSinceLastSession(client: Client, now = new Date()): number | undefined {
  if (!client.lastSessionAt) return undefined;
  return monthsBetween(new Date(client.lastSessionAt), now);
}

/** A follow-up stays hidden this long after she contacts the client. */
export const CONTACT_SNOOZE_DAYS = 30;

/**
 * A lapsed client had sessions, has none in `months`, has nothing booked,
 * and was not contacted recently.
 */
export function isLapsed(client: Client, months: number, now = new Date()): boolean {
  const since = monthsSinceLastSession(client, now);
  if (since === undefined || since < months) return false;
  if (client.nextBookedAt && new Date(client.nextBookedAt) > now) return false;
  if (client.lastContactedAt) {
    const days = (now.getTime() - new Date(client.lastContactedAt).getTime()) / 86_400_000;
    if (days < CONTACT_SNOOZE_DAYS) return false;
  }
  return true;
}
