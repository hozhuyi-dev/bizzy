import { describe, expect, test } from "vitest";
import { paymentCover } from "./session-payment";
import type { Session } from "./sessions.types";
import type { Client } from "~/features/clients/clients.types";
import type { Package } from "~/features/packages/packages.types";

const jane: Client = { id: "jane", name: "Jane", aliases: ["jane"], defaultFeeCents: 9000 };
const start = new Date("2026-10-10T02:00:00Z");

function pkg(id: string, purchasedAt: string, sessions: number, creditsUsed: number): Package {
  return { id, clientId: "jane", sessions, priceCents: 85000, purchasedAt, source: "app", creditsUsed };
}

describe("paymentCover", () => {
  test("a package bought in the session covers it", () => {
    expect(paymentCover({ client: jane, start, packages: [], boughtHere: true })).toEqual({ kind: "bought" });
  });

  test("the oldest package with a credit left, bought by then", () => {
    const used = pkg("used", "2026-09-01T00:00:00Z", 5, 5);
    const older = pkg("older", "2026-09-10T00:00:00Z", 5, 2);
    const newer = pkg("newer", "2026-09-20T00:00:00Z", 5, 0);
    const later = pkg("later", "2026-10-11T00:00:00Z", 5, 0);
    const cover = paymentCover({ client: jane, start, packages: [later, newer, used, older], boughtHere: false });
    expect(cover).toEqual({ kind: "credit", pkg: older });
  });

  test("the credit the session already holds, even if it was the last", () => {
    const held = pkg("held", "2026-09-01T00:00:00Z", 5, 5);
    const session = { eventId: "e1", clientId: "jane", packageId: "held" } as Session;
    expect(paymentCover({ client: jane, start, packages: [held], boughtHere: false, session })).toEqual({
      kind: "credit",
      pkg: held,
    });
  });

  test("the package the stored title bought is the form's to say", () => {
    const own = pkg("e1", "2026-10-10T02:00:00Z", 10, 1);
    const session = { eventId: "e1", clientId: "jane" } as Session;
    const cover = paymentCover({ client: jane, start, packages: [own], boughtHere: false, session });
    expect(cover).toEqual({ kind: "default", feeCents: 9000 });
  });

  test("the default fee, else nothing", () => {
    expect(paymentCover({ client: jane, start, packages: [], boughtHere: false })).toEqual({
      kind: "default",
      feeCents: 9000,
    });
    const noFee: Client = { id: "bob", name: "Bob", aliases: ["bob"] };
    expect(paymentCover({ client: noFee, start, packages: [], boughtHere: false })).toEqual({ kind: "none" });
  });
});
