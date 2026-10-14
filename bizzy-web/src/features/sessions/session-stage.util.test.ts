import { describe, expect, test } from "vitest";
import { documentItems, isUnmatched, stageBadges } from "./session-stage.util";
import type { Session, SessionCan } from "./sessions.types";
import type { Package, PackageCan } from "~/features/packages/packages.types";

// The rules themselves are the API's (sessions/rules.go, tested there):
// these check only how what it sends is shown.

const yes = { ok: true };
const no = (why: string) => ({ ok: false, why });

const can: SessionCan = {
  settle: yes,
  pay: yes,
  undoPayment: yes,
  invoice: yes,
  receipt: no("only a paid session without a receipt can get one"),
  record: yes,
  attach: yes,
  delete: yes,
  restore: no("This session is still in the calendar."),
  discard: no("This session is still in the calendar."),
};

/** A priced session that has happened, as the API sends it. */
function session(overrides: Partial<Session> = {}): Session {
  return {
    eventId: "e1",
    title: "Jane Smith",
    start: "2026-10-12T06:00:00Z",
    end: "2026-10-12T07:00:00Z",
    status: "priced",
    clientId: "jane",
    feeCents: 9500,
    version: 1,
    state: {
      presence: "in-calendar",
      status: "priced",
      client: "matched",
      timing: "happened",
      record: "none",
      fee: "owed",
      payment: "none",
      paidFor: "current",
      bought: "none",
      invoice: "empty",
      receipt: "empty",
      drift: "none",
    },
    rules: [],
    todo: [],
    fixes: [],
    dueCents: 9500,
    owedCents: 0,
    boughtOwedCents: 0,
    delivered: true,
    paid: true,
    can,
    ...overrides,
  };
}

describe("stageBadges", () => {
  test("each rule that holds shows once", () => {
    expect(stageBadges(session({ rules: ["unrecorded", "unpaid"] })).map((b) => b.label)).toEqual(["To record", "Unpaid"]);
    expect(stageBadges(session({ rules: ["client-unmatched", "contradicts-document"] })).map((b) => b.label)).toEqual([
      "Unmatched",
      "Changed after document",
    ]);
  });

  test("with none, where it stands", () => {
    expect(stageBadges(session())[0]?.label).toBe("Done");
    expect(stageBadges(session({ payment: { status: "waived", amountCents: 0, paidOn: "2026-10-12", updatedAt: "" } }))[0]?.label).toBe(
      "Waived",
    );
    const ahead = session();
    expect(stageBadges({ ...ahead, state: { ...ahead.state, timing: "upcoming" } })[0]?.label).toBe("Booked");
  });

  test("an unknown rule shows nothing rather than a guess", () => {
    expect(stageBadges(session({ rules: ["some-new-rule"] }))[0]?.label).toBe("Done");
  });

  test("unmatched, read from the rules", () => {
    expect(isUnmatched(session({ rules: ["tentative-unknown-client"] }))).toBe(true);
    expect(isUnmatched(session({ rules: ["fee-missing"] }))).toBe(false);
  });
});

describe("documentItems", () => {
  const pkgCan: PackageCan = {
    pay: yes,
    invoice: yes,
    receipt: no("only a paid package can get a receipt"),
    edit: no("x"),
    delete: no("x"),
    makeStandalone: no("x"),
  };
  const bought: Package = {
    id: "e1",
    clientId: "jane",
    sessions: 10,
    priceCents: 85000,
    purchasedAt: "2026-10-12T06:00:00Z",
    source: "calendar",
    creditsUsed: 1,
    rules: [],
    todo: [],
    fixes: [],
    creditsLeft: 9,
    owedCents: 85000,
    can: pkgCan,
  };
  const available = (items: ReturnType<typeof documentItems>) => items.filter((i) => !i.unavailable).map((i) => i.source.kind);

  test("each item is offered as the API allows it", () => {
    expect(available(documentItems("invoice", session(), bought))).toEqual(["session", "package"]);
    expect(available(documentItems("receipt", session(), bought))).toEqual([]);
    expect(documentItems("receipt", session(), bought).map((i) => i.unavailable)).toEqual(["Not paid yet", "Not paid yet"]);
    expect(available(documentItems("receipt", session({ can: { ...can, receipt: yes } }), bought))).toEqual(["session"]);
  });

  test("one already on a document says so", () => {
    const invoiced = session({ invoice: { documentId: "d1", number: "INV260001" }, can: { ...can, invoice: no("x") } });
    expect(documentItems("invoice", invoiced, bought)[0]?.unavailable).toBe("On an invoice already");
  });

  test("a package no longer bought in the session is not its document's", () => {
    expect(documentItems("invoice", session(), { ...bought, source: "app" })).toHaveLength(1);
    expect(documentItems("invoice", session(), { ...bought, unlinked: true })).toHaveLength(1);
  });
});
