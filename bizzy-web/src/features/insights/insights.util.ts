import type { InsightsTotals, InsightsView } from "./insights.types";

/** What the year's months add up to, and how received compares with a year earlier. */
export function insightsTotals(view: InsightsView): InsightsTotals {
  let receivedCents = 0;
  let spentCents = 0;
  let sessions = 0;
  for (const m of view.months) {
    receivedCents += m.receivedCents;
    spentCents += m.spentCents;
    sessions += m.sessions;
  }
  return {
    receivedCents,
    spentCents,
    leftCents: receivedCents - spentCents,
    sessions,
    receivedChange:
      view.previousReceivedCents > 0 ? (receivedCents - view.previousReceivedCents) / view.previousReceivedCents : undefined,
  };
}

/** "▲ 12%": a change as a fraction, rounded to a whole percent. */
export function formatChange(change: number): string {
  return `${change >= 0 ? "▲" : "▼"} ${Math.abs(Math.round(change * 100))}%`;
}

/** A part of a whole as a whole percent: "81%", or "—" with no whole. */
export function formatShare(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—";
}
