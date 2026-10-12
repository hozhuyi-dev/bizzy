import { describe, expect, test } from "vitest";
import { canInvoice, canReceipt, documentSources, dueCents, stageBadges, todoReasons } from "./session-stage";
import type { Session } from "./sessions.types";
import type { Package } from "~/features/packages/packages.types";

const now = new Date("2026-10-12T09:00:00Z");

/** A priced session that ended two hours before now; `without` drops fields. */
function session(overrides: Partial<Session> = {}, without: Array<keyof Session> = []): Session {
  const s: Session = {
    eventId: "e1",
    title: "Jane Smith",
    start: "2026-10-12T06:00:00Z",
    end: "2026-10-12T07:00:00Z",
    status: "priced",
    clientId: "jane",
    feeCents: 9500,
    version: 1,
    ...overrides,
  };
  for (const key of without) delete s[key];
  return s;
}

const paid = { status: "paid", method: "tng", amountCents: 9500, paidOn: "2026-10-12", updatedAt: "" } as const;
const record = { summary: "Knee", updatedAt: "" };

describe("todoReasons", () => {
  test("a session that happened needs notes and payment", () => {
    expect(todoReasons(session(), now)).toEqual(["record", "collect"]);
  });

  test("payment may come before the notes", () => {
    expect(todoReasons(session({ payment: paid }), now)).toEqual(["record"]);
  });

  test("a booking ahead needs nothing yet; a tentative one needs confirming", () => {
    const ahead = { start: "2026-10-13T06:00:00Z", end: "2026-10-13T07:00:00Z" };
    expect(todoReasons(session(ahead), now)).toEqual([]);
    expect(todoReasons(session({ ...ahead, status: "tentative" }), now)).toEqual(["confirm"]);
  });

  test("deleted and broken entries come first", () => {
    expect(todoReasons(session({ removedAt: "2026-10-12T08:00:00Z", record }), now)).toEqual(["deleted"]);
    expect(todoReasons(session({ status: "unmatched" }, ["clientId"]), now)).toEqual(["fix"]);
  });

  test("a package credit costs nothing more; history before tracking needs nothing", () => {
    expect(todoReasons(session({ status: "package", record }, ["feeCents"]), now)).toEqual([]);
    expect(todoReasons(session({ untracked: true }), now)).toEqual([]);
  });
});

describe("stageBadges", () => {
  test("say what is left, or that it is done", () => {
    expect(stageBadges(session(), now).map((b) => b.label)).toEqual(["To record", "Unpaid"]);
    expect(stageBadges(session({ record, payment: paid }), now).map((b) => b.label)).toEqual(["Done"]);
    expect(stageBadges(session({ start: "2026-10-20T06:00:00Z", end: "2026-10-20T07:00:00Z" }), now)[0]?.label).toBe(
      "Booked",
    );
  });
});

describe("documents", () => {
  const bought: Package = {
    id: "e1",
    clientId: "jane",
    sessions: 10,
    priceCents: 85000,
    purchasedAt: "2026-10-12T06:00:00Z",
    source: "calendar",
    creditsUsed: 1,
  };

  test("an invoice any time once confirmed with a fee; a receipt once paid", () => {
    expect(canInvoice(session())).toBe(true);
    expect(canReceipt(session())).toBe(false);
    expect(canReceipt(session({ payment: paid }))).toBe(true);
    expect(canReceipt(session({ payment: { ...paid, status: "waived" } }))).toBe(false);
  });

  test("a package bought in the session is due with it and goes on its documents", () => {
    const s = session({ boughtCents: 85000 });
    expect(dueCents(s)).toBe(94500);
    expect(documentSources("invoice", s, bought)).toEqual([
      { kind: "session", id: "e1" },
      { kind: "package", id: "e1" },
    ]);
    expect(documentSources("receipt", s, bought)).toEqual([]);
    expect(documentSources("receipt", { ...s, payment: paid }, bought)).toHaveLength(2);
  });
});
