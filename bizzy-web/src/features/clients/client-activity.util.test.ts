import { isLapsed, last12Months, totals } from "./client-activity.util";
import type { ClientView } from "./clients.types";
import type { ActivityView } from "~/features/activity/activity.types";

const now = new Date(2026, 9, 11);

const client: ClientView = { id: "c", name: "Jane", aliases: [], feeRates: [], homeVisits: false };

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

  test("lapsed after the threshold", () => {
    expect(isLapsed(client, jane, 3, now)).toBe(true);
    expect(isLapsed(client, jane, 6, now)).toBe(false);
  });

  test("not lapsed when booked or recently contacted", () => {
    expect(isLapsed(client, { ...jane, nextBookedAt: new Date(2026, 9, 20).toISOString() }, 3, now)).toBe(false);
    expect(isLapsed({ ...client, lastContactedAt: new Date(2026, 9, 1).toISOString() }, jane, 3, now)).toBe(false);
    expect(isLapsed({ ...client, lastContactedAt: new Date(2026, 7, 1).toISOString() }, jane, 3, now)).toBe(true);
  });

  test("never lapsed without sessions", () => {
    expect(isLapsed(client, undefined, 3, now)).toBe(false);
    expect(totals(undefined).sessions).toBe(0);
  });
});
