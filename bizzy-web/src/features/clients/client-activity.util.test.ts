import { last12Months, monthsSinceLastSession, totals } from "./client-activity.util";
import type { ActivityView } from "~/features/activity/activity.types";

const now = new Date(2026, 9, 11);

const jane: ActivityView = {
  clientId: "c",
  months: {
    "2025-09": { sessions: 4, receivedCents: 40000, earnedCents: 40000 },
    "2026-03": { sessions: 2, receivedCents: 85000, earnedCents: 17000 },
    "2026-04": { sessions: 3, homeSessions: 1, receivedCents: 0, earnedCents: 25500, homeEarnedCents: 8500 },
  },
  lastSessionAt: new Date(2026, 3, 20).toISOString(),
};

describe("client activity", () => {
  test("sums every month", () => {
    expect(totals(jane)).toMatchObject({ sessions: 9, receivedCents: 125000, homeSessions: 1 });
  });

  test("last 12 months leaves older months out", () => {
    expect(last12Months(jane, now)).toMatchObject({ sessions: 5, earnedCents: 42500 });
  });

  test("months since the last session", () => {
    expect(monthsSinceLastSession(jane, now)).toBe(5);
    expect(monthsSinceLastSession(undefined, now)).toBeUndefined();
  });

  test("nothing without activity", () => {
    expect(totals(undefined).sessions).toBe(0);
  });
});
