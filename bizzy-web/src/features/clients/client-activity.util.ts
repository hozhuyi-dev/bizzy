import { CONTACT_SNOOZE_DAYS } from "./clients.constant";
import type { ActivityTotals, ClientView } from "./clients.types";
import type { ActivityView, MonthActivity } from "~/features/activity/activity.types";
import { addMonths, monthKey, monthsBetween } from "~/core/utils/date.util";

/**
 * Client figures summed from the per-month activity the API works out for
 * each client. Everything here is pure, so rolling windows ("last 12
 * months") never go stale. A client with no activity yet has none.
 */

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
export function totals(activity: ActivityView | undefined, from?: string, to?: string): ActivityTotals {
  let total = EMPTY;
  for (const [month, monthActivity] of Object.entries(activity?.months ?? {})) {
    if ((from && month < from) || (to && month > to)) continue;
    total = addActivity(total, monthActivity);
  }
  return total;
}

/** The last 12 months including this one. */
export function last12Months(activity: ActivityView | undefined, now = new Date()): ActivityTotals {
  const current = monthKey(now);
  return totals(activity, addMonths(current, -11), current);
}

export function monthsSinceLastSession(activity: ActivityView | undefined, now = new Date()): number | undefined {
  if (!activity?.lastSessionAt) return undefined;
  return monthsBetween(new Date(activity.lastSessionAt), now);
}

/**
 * A lapsed client had sessions, has none in `months`, has nothing booked,
 * and was not contacted recently.
 */
export function isLapsed(client: ClientView, activity: ActivityView | undefined, months: number, now = new Date()): boolean {
  const since = monthsSinceLastSession(activity, now);
  if (since === undefined || since < months) return false;
  if (activity?.nextBookedAt && new Date(activity.nextBookedAt) > now) return false;
  if (client.lastContactedAt) {
    const days = (now.getTime() - new Date(client.lastContactedAt).getTime()) / 86_400_000;
    if (days < CONTACT_SNOOZE_DAYS) return false;
  }
  return true;
}
