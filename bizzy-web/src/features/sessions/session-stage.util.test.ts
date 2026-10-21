import { describe, expect, test } from "vitest";
import {
  allSessionDocuments,
  coverText,
  coveringCredits,
  documentItems,
  lengthAndPlace,
  recordText,
  sessionAmount,
  stageBadges,
} from "./session-stage.util";
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
    hours: 1,
    credits: [],
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
    hours: 10,
    purchasedAt: "2026-10-12T06:00:00Z",
    boughtIn: "s1",
    creditsUsed: 1,
    creditsLeft: 9,
    priceCents: 85000,
    invoice: { id: "d1" },
    owedCents: 85000,
    todo: [],
    locked: {},
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
    const bought = session({ bought: { id: "p1", hours: 10, priceCents: 85000, paid: false } });
    expect(documentItems(bought).map((item) => item.label)).toEqual(["Session fee", "Package of 10 h"]);
  });

  test("credits paying it all leave the session nothing of its own to bill", () => {
    const { invoice: _, ...rest } = session();
    const onCredit = { ...rest, credits: [{ packageId: "p0", hours: 1 }], feeCents: 0 };
    expect(documentItems(onCredit)).toEqual([]);
    expect(sessionAmount(onCredit)).toBeUndefined();
  });

  test("what credits leave is billed as its fee", () => {
    const partly = session({ hours: 1.5, credits: [{ packageId: "p0", hours: 1 }], feeCents: 4750 });
    expect(documentItems(partly)).toEqual([{ source: { kind: "session", id: "s1" }, label: "Session fee", amountCents: 4750 }]);
    expect(sessionAmount(partly)).toBe(4750);
  });
});

describe("coveringCredits", () => {
  test("pairs each credit with its package, as far as they are loaded", () => {
    const covered = session({ credits: [{ packageId: "p1", hours: 0.5 }, { packageId: "p2", hours: 1 }] });
    expect(coveringCredits(covered, [pkg()])).toEqual([{ pkg: pkg(), hours: 0.5 }]);
    expect(coveringCredits(covered, undefined)).toEqual([]);
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

  test("shows an issued receipt's number, as an invoice's", () => {
    const paid = session({
      paid: { amountCents: 9500, method: "cash", paidOn: "2026-10-12", receiptId: "r1", receiptNumber: "RCP260001", issued: true },
    });
    expect(allSessionDocuments(paid, undefined)).toContainEqual({
      type: "receipt",
      ref: { id: "r1", number: "RCP260001" },
      issued: true,
    });
  });
});

describe("list lines", () => {
  test("how long and where, in words", () => {
    expect(lengthAndPlace(session())).toBe("1 h · Your place");
    expect(lengthAndPlace(session({ end: "2026-10-12T07:30:00Z", location: "visit" }))).toBe("1.5 h · Home visit");
  });

  test("what was recorded besides the summary, or nothing", () => {
    expect(recordText({ summary: "Neck", hasNotes: false, files: 0 })).toBeUndefined();
    expect(recordText({ summary: "", hasNotes: true, files: 1 })).toBe("Notes · 1 file");
    expect(recordText({ summary: "", hasNotes: false, files: 3 })).toBe("3 files");
  });

  test("what credits pay and the package bought", () => {
    expect(coverText(session())).toBeUndefined();
    expect(
      coverText(session({ credits: [{ packageId: "p0", hours: 0.5 }, { packageId: "p1", hours: 0.5 }] })),
    ).toBe("1 h on credits");
    expect(coverText(session({ bought: { id: "p1", hours: 10, priceCents: 85000, paid: false } }))).toBe("+ 10 h package");
  });
});
