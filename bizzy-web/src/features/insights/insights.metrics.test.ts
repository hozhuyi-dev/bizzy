import { change, monthTotals, monthlySeries, summarize, topClients, yearlySeries } from "./insights.metrics";
import type { Client } from "~/features/clients/clients.types";

const clients: Array<Client> = [
  {
    id: "jane",
    name: "Jane",
    aliases: [],
    activity: {
      "2025-10": { sessions: 2, receivedCents: 20000, earnedCents: 20000 },
      "2026-09": { sessions: 3, homeSessions: 1, receivedCents: 85000, earnedCents: 25500, homeEarnedCents: 8500 },
      "2026-10": { sessions: 2, receivedCents: 0, earnedCents: 17000 },
    },
  },
  {
    id: "bob",
    name: "Bob",
    aliases: [],
    activity: { "2026-10": { sessions: 1, receivedCents: 12000, earnedCents: 12000 } },
  },
];

describe("insights metrics", () => {
  const totals = monthTotals(clients);

  test("monthly series compares with last year and counts new clients", () => {
    const series = monthlySeries(totals, "received", "2026-10", 2);
    expect(series.map((p) => p.month)).toEqual(["2026-09", "2026-10"]);
    expect(series[1]).toMatchObject({
      cents: 12000,
      lastYearCents: 20000,
      sessions: 3,
      activeClients: 2,
      newClients: 1,
      avgCents: 9667,
    });
  });

  test("earned basis spreads package money over its sessions", () => {
    const [sep, oct] = monthlySeries(totals, "earned", "2026-10", 2);
    expect(sep?.cents).toBe(25500);
    expect(oct?.cents).toBe(29000);
  });

  test("yearly totals", () => {
    expect(yearlySeries(totals, "received")).toEqual([
      { year: "2025", cents: 20000, sessions: 2 },
      { year: "2026", cents: 97000, sessions: 6 },
    ]);
  });

  test("summarize a period", () => {
    expect(summarize(totals, "earned", "2026-01", "2026-12")).toEqual({
      cents: 54500,
      sessions: 6,
      homeSessions: 1,
      homeCents: 8500,
    });
  });

  test("top clients with their share", () => {
    const top = topClients(clients, "received", "2026-01", "2026-12");
    expect(top.map((c) => c.id)).toEqual(["jane", "bob"]);
    expect(top[0]?.share).toBeCloseTo(85000 / 97000);
  });

  test("change needs a base", () => {
    expect(change(110, 100)).toBeCloseTo(0.1);
    expect(change(5, 0)).toBeUndefined();
  });
});
