import { describe, expect, test } from "vitest";
import { canInvoice, canReceipt, documentItems, dueCents, isPaid, owedCents, stageBadges, todoReasons } from "./session-stage";
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

  test("a tentative one no client matches needs fixing before confirming", () => {
    const unknown = session({ start: "2026-10-13T06:00:00Z", end: "2026-10-13T07:00:00Z", status: "tentative" }, ["clientId"]);
    expect(todoReasons(unknown, now)).toEqual(["fix"]);
    expect(stageBadges(unknown, now)).toEqual([{ label: "Unmatched", tone: "attention" }]);
  });

  test("deleted and broken entries come first", () => {
    expect(todoReasons(session({ removedAt: "2026-10-12T08:00:00Z", record }), now)).toEqual(["deleted"]);
    expect(todoReasons(session({ status: "unmatched" }, ["clientId"]), now)).toEqual(["fix"]);
  });

  test("a package credit costs nothing more", () => {
    expect(todoReasons(session({ status: "package", record }, ["feeCents"]), now)).toEqual([]);
  });

  test("the package bought in a session is collected on it until paid", () => {
    const bought = session({ record, payment: paid, boughtCents: 85000 });
    expect(todoReasons(bought, now)).toEqual(["collect"]);
    expect(todoReasons({ ...bought, boughtSettled: true }, now)).toEqual([]);
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

  test("the fee and the package bought are due on their own", () => {
    const s = session({ boughtCents: 85000 });
    expect(dueCents(s)).toBe(9500);
    expect(owedCents(s)).toBe(94500);
    expect(owedCents({ ...s, payment: paid })).toBe(85000);
    expect(isPaid({ ...s, payment: paid })).toBe(false);
    expect(isPaid({ ...s, payment: paid, boughtSettled: true })).toBe(true);
  });

  test("each item goes on a document on its own; a receipt needs that item paid", () => {
    const s = session({ boughtCents: 85000 });
    const available = (items: ReturnType<typeof documentItems>) => items.filter((i) => !i.unavailable).map((i) => i.source.kind);

    expect(available(documentItems("invoice", s, bought))).toEqual(["session", "package"]);
    expect(available(documentItems("receipt", s, bought))).toEqual([]);
    // The session paid, the package not: a receipt for the fee alone.
    expect(available(documentItems("receipt", { ...s, payment: paid }, bought))).toEqual(["session"]);
    expect(available(documentItems("receipt", s, { ...bought, payment: paid }))).toEqual(["package"]);
    // Already on an invoice: the rest can go on another.
    const invoiced = { documentId: "d1", number: "INV260001" };
    expect(available(documentItems("invoice", { ...s, invoice: invoiced }, bought))).toEqual(["package"]);
  });

  test("a package no longer bought in the session is not its document's", () => {
    expect(documentItems("invoice", session(), { ...bought, source: "app" })).toHaveLength(1);
  });
});
