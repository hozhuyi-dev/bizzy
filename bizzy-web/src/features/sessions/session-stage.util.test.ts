import { describe, expect, test } from "vitest";
import { allSessionDocuments, documentItems, sessionAmount, stageBadges } from "./session-stage.util";
import type { SessionCan, SessionView } from "./sessions.types";
import type { PackageView } from "~/features/packages/packages.types";

// The rules themselves are the API's (tested there): these check only how
// what it sends is shown.

const yes = { ok: true };

const can: SessionCan = { record: yes, pay: yes, undoPayment: yes, delete: yes };

const now = new Date("2026-10-13T00:00:00Z");

/** A session that has happened, on a draft invoice, as the API sends it. */
function session(overrides: Partial<SessionView> = {}): SessionView {
  return {
    id: "s1",
    clientId: "jane",
    clientName: "Jane",
    start: "2026-10-12T06:00:00Z",
    end: "2026-10-12T07:00:00Z",
    tentative: false,
    location: "own",
    feeCents: 9500,
    feeTyped: false,
    invoice: { id: "d1" },
    owedCents: 9500,
    record: { summary: "", hasNotes: false, files: 0 },
    todo: [],
    can,
    ...overrides,
  };
}

function pkg(overrides: Partial<PackageView> = {}): PackageView {
  return {
    id: "p1",
    clientId: "jane",
    sessions: 10,
    purchasedAt: "2026-10-12T06:00:00Z",
    boughtIn: "s1",
    creditsUsed: 1,
    creditsLeft: 9,
    priceCents: 85000,
    invoice: { id: "d1" },
    owedCents: 85000,
    todo: [],
    ...overrides,
  };
}

describe("stageBadges", () => {
  test("shows what is left to do", () => {
    expect(stageBadges(session({ todo: ["record", "collect"] }), now).map((b) => b.label)).toEqual(["To record", "Unpaid"]);
  });

  test("a quiet session is booked or done", () => {
    expect(stageBadges(session(), now).map((b) => b.label)).toEqual(["Done"]);
    const ahead = session({ start: "2026-10-14T06:00:00Z", end: "2026-10-14T07:00:00Z" });
    expect(stageBadges(ahead, now).map((b) => b.label)).toEqual(["Booked"]);
  });
});

describe("documentItems", () => {
  test("a session's fee and the package bought in it", () => {
    const bought = session({ bought: { id: "p1", sessions: 10, priceCents: 85000, paid: false } });
    expect(documentItems(bought).map((item) => item.label)).toEqual(["Session fee", "Package of 10"]);
  });

  test("a credit leaves the session nothing of its own to bill", () => {
    const { invoice: _, ...rest } = session();
    const onCredit = { ...rest, packageId: "p0", feeCents: 0 };
    expect(documentItems(onCredit)).toEqual([]);
    expect(sessionAmount(onCredit)).toBeUndefined();
  });
});

describe("allSessionDocuments", () => {
  test("lists a shared invoice once", () => {
    expect(allSessionDocuments(session(), pkg())).toEqual([{ type: "invoice", ref: { id: "d1" }, issued: false }]);
  });

  test("knows a receipt by the payment it records", () => {
    const paid = session({
      invoice: { id: "d1", number: "INV260001" },
      paid: { amountCents: 9500, method: "cash", paidOn: "2026-10-12", receiptId: "r1", issued: true },
    });
    expect(allSessionDocuments(paid, undefined)).toEqual([
      { type: "invoice", ref: { id: "d1", number: "INV260001" }, issued: true },
      { type: "receipt", ref: { id: "r1" }, issued: true },
    ]);
  });
});
