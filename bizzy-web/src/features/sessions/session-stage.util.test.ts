import { describe, expect, test } from "vitest";
import { allSessionDocuments, documentItems, sessionAmount, stageBadges } from "./session-stage.util";
import type { Session, SessionCan } from "./sessions.types";
import type { Package, PackageCan } from "~/features/packages/packages.types";

// The rules themselves are the API's (sessions/rules.go, tested there):
// these check only how what it sends is shown.

const yes = { ok: true };

const can: SessionCan = { record: yes, attach: yes, pay: yes, undoPayment: yes, delete: yes };

/** A session that has happened, on a draft invoice, as the API sends it. */
function session(overrides: Partial<Session> = {}): Session {
  return {
    id: "s1",
    clientId: "jane",
    start: "2026-10-12T06:00:00Z",
    end: "2026-10-12T07:00:00Z",
    location: "own",
    feeCents: 9500,
    invoice: { documentId: "d1" },
    event: { eventId: "e1" },
    createdAt: "2026-10-12T00:00:00Z",
    version: 1,
    state: {
      confirmed: "confirmed",
      timing: "happened",
      record: "none",
      cover: "fee",
      fee: "charged",
      invoice: "draft",
      receipt: "empty",
      payment: "none",
      bought: "none",
    },
    rules: [],
    todo: [],
    fixes: [],
    owedCents: 9500,
    settled: false,
    can,
    ...overrides,
  };
}

const pkgCan: PackageCan = { pay: yes, undoPayment: yes, edit: yes, delete: yes, makeStandalone: yes };

function pkg(overrides: Partial<Package> = {}): Package {
  return {
    id: "p1",
    clientId: "jane",
    sessions: 10,
    purchasedAt: "2026-10-12T06:00:00Z",
    boughtIn: "s1",
    creditsUsed: 1,
    priceCents: 85000,
    invoice: { documentId: "d1" },
    version: 1,
    rules: [],
    todo: [],
    fixes: [],
    creditsLeft: 9,
    owedCents: 85000,
    can: pkgCan,
    ...overrides,
  };
}

describe("stageBadges", () => {
  test("shows the rules that hold", () => {
    expect(stageBadges(session({ rules: ["unrecorded", "unpaid"] })).map((b) => b.label)).toEqual(["To record", "Unpaid"]);
  });

  test("a quiet session is booked or done", () => {
    expect(stageBadges(session()).map((b) => b.label)).toEqual(["Done"]);
    const ahead = session({ state: { ...session().state, timing: "upcoming" } });
    expect(stageBadges(ahead).map((b) => b.label)).toEqual(["Booked"]);
  });
});

describe("documentItems", () => {
  test("a session's fee and the package bought in it", () => {
    expect(documentItems(session(), pkg()).map((item) => item.label)).toEqual(["Session fee", "Package of 10"]);
  });

  test("a credit leaves the session nothing of its own to bill", () => {
    const { invoice: _, ...rest } = session();
    const onCredit = { ...rest, packageId: "p0", feeCents: 0 };
    expect(documentItems(onCredit, undefined)).toEqual([]);
    expect(sessionAmount(onCredit)).toBeUndefined();
  });
});

test("allSessionDocuments lists a shared invoice once", () => {
  expect(allSessionDocuments(session(), pkg())).toEqual([{ type: "invoice", ref: { documentId: "d1" } }]);
});
