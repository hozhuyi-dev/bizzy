import type { Basis, ClientShare, MonthPoint, MonthTotal, PeriodSummary, YearPoint } from "./insights.types";
import type { ActivityView } from "~/features/activity/activity.types";
import { addMonths } from "~/core/utils/date.util";

/**
 * Business metrics summed from each client's monthly activity. Two bases:
 * "received" is money in the month it was paid (packages when bought, which
 * is what matters for tax); "earned" values sessions as they happen.
 */

/** Sums every client by month, once, for all the charts. */
export function monthTotals(activities: ReadonlyArray<ActivityView>): Map<string, MonthTotal> {
  const totals = new Map<string, MonthTotal>();
  for (const activity of activities) {
    const first = firstMonth(activity);
    for (const [month, a] of Object.entries(activity.months)) {
      const t = totals.get(month) ?? { received: 0, earned: 0, sessions: 0, homeSessions: 0, homeEarned: 0, active: 0, new: 0 };
      t.received += a.receivedCents;
      t.earned += a.earnedCents;
      t.sessions += a.sessions;
      t.homeSessions += a.homeSessions ?? 0;
      t.homeEarned += a.homeEarnedCents ?? 0;
      if (a.sessions > 0) t.active++;
      if (month === first) t.new++;
      totals.set(month, t);
    }
  }
  return totals;
}

/** The first month a client had a session. */
export function firstMonth(activity: ActivityView): string | undefined {
  return Object.entries(activity.months)
    .filter(([, a]) => a.sessions > 0)
    .map(([month]) => month)
    .sort()[0];
}

function amount(t: MonthTotal | undefined, basis: Basis): number {
  if (!t) return 0;
  return basis === "received" ? t.received : t.earned;
}

/** `count` months ending with `endMonth`, oldest first. */
export function monthlySeries(
  totals: Map<string, MonthTotal>,
  basis: Basis,
  endMonth: string,
  count = 12,
): Array<MonthPoint> {
  return Array.from({ length: count }, (_, i) => {
    const month = addMonths(endMonth, i - count + 1);
    const t = totals.get(month);
    return {
      month,
      cents: amount(t, basis),
      lastYearCents: amount(totals.get(addMonths(month, -12)), basis),
      sessions: t?.sessions ?? 0,
      homeSessions: t?.homeSessions ?? 0,
      avgCents: t && t.sessions > 0 ? Math.round(t.earned / t.sessions) : undefined,
      activeClients: t?.active ?? 0,
      newClients: t?.new ?? 0,
    };
  });
}

export function yearlySeries(totals: Map<string, MonthTotal>, basis: Basis): Array<YearPoint> {
  const years = new Map<string, YearPoint>();
  for (const [month, t] of totals) {
    const year = month.slice(0, 4);
    const y = years.get(year) ?? { year, cents: 0, sessions: 0 };
    y.cents += amount(t, basis);
    y.sessions += t.sessions;
    years.set(year, y);
  }
  return [...years.values()].sort((a, b) => a.year.localeCompare(b.year));
}

/** Sums months in [from, to]. */
export function summarize(totals: Map<string, MonthTotal>, basis: Basis, from: string, to: string): PeriodSummary {
  const out: PeriodSummary = { cents: 0, sessions: 0, homeSessions: 0, homeCents: 0 };
  for (const [month, t] of totals) {
    if (month < from || month > to) continue;
    out.cents += amount(t, basis);
    out.sessions += t.sessions;
    out.homeSessions += t.homeSessions;
    out.homeCents += t.homeEarned;
  }
  return out;
}

/** The clients who brought in the most in [from, to]. */
export function topClients(
  activities: ReadonlyArray<ActivityView>,
  names: ReadonlyMap<string, { name: string }>,
  basis: Basis,
  from: string,
  to: string,
  limit = 8,
): Array<ClientShare> {
  const rows = activities.map((activity) => {
    let cents = 0;
    for (const [month, a] of Object.entries(activity.months)) {
      if (month >= from && month <= to) cents += basis === "received" ? a.receivedCents : a.earnedCents;
    }
    return { id: activity.clientId, name: names.get(activity.clientId)?.name ?? "Unknown client", cents };
  });
  const total = rows.reduce((sum, r) => sum + r.cents, 0);
  return rows
    .filter((r) => r.cents > 0)
    .sort((a, b) => b.cents - a.cents)
    .slice(0, limit)
    .map((r) => ({ ...r, share: total ? r.cents / total : 0 }));
}

/** Percentage change, or undefined when there is nothing to compare with. */
export function change(current: number, previous: number): number | undefined {
  if (previous === 0) return undefined;
  return (current - previous) / previous;
}
