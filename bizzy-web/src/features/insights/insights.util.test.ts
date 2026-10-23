import { describe, expect, it } from "vitest";
import { formatChange, formatShare, insightsTotals } from "./insights.util";
import type { InsightsView } from "./insights.types";

const view: InsightsView = {
  year: 2026,
  years: [2026, 2025],
  months: [
    { month: "2026-01", receivedCents: 40000, spentCents: 2500, sessions: 5, newSessions: 1 },
    { month: "2026-02", receivedCents: 20000, spentCents: 7500, sessions: 3, newSessions: 0 },
  ],
  previousReceivedCents: 50000,
  spentByCategory: {},
  prepaidMinutes: 90,
  prepaidCents: 12000,
};

describe("insightsTotals", () => {
  it("sums the months and compares received with a year earlier", () => {
    expect(insightsTotals(view)).toEqual({
      receivedCents: 60000,
      spentCents: 10000,
      leftCents: 50000,
      sessions: 8,
      receivedChange: 0.2,
    });
  });

  it("has nothing to compare with when nothing came in a year earlier", () => {
    expect(insightsTotals({ ...view, previousReceivedCents: 0 }).receivedChange).toBeUndefined();
  });
});

describe("formats", () => {
  it("writes a change with its direction", () => {
    expect(formatChange(0.124)).toBe("▲ 12%");
    expect(formatChange(-0.5)).toBe("▼ 50%");
  });

  it("writes a share, or a dash with no whole", () => {
    expect(formatShare(50000, 60000)).toBe("83%");
    expect(formatShare(1, 0)).toBe("—");
  });
});
