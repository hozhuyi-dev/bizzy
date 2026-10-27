import { describe, expect, it } from "vitest";
import { toPackageFields, toPackageValues } from "./packages.form";
import type { PackageView } from "./packages.types";

const OK = { ok: true };

function pkg(over: Partial<PackageView> = {}): PackageView {
  return {
    id: "p1",
    clientId: "c1",
    hours: 10,
    purchasedAt: "2026-10-01T02:00:00.000Z",
    sharedWith: [],
    uses: [],
    payer: "c1",
    creditsUsed: 0,
    creditsLeft: 10,
    priceCents: 85000,
    owedCents: 85000,
    todo: [],
    can: { pay: OK, undoPayment: OK, askToPay: OK, sendRecords: OK, makeStandalone: OK, delete: OK },
    locked: {},
    ...over,
  };
}

const PAID = { amountCents: 85000, method: "cash", paidOn: "2026-10-02", receiptId: "r1", issued: false } as const;

describe("toPackageFields", () => {
  it("sends a new package's payment with it", () => {
    const values = { ...toPackageValues(undefined, "c1"), price: "850", paidBy: "tng" as const, paidOn: "2026-10-03" };
    expect(toPackageFields(values, undefined).payment).toEqual({ payment: { method: "tng", paidOn: "2026-10-03" } });
  });

  it("sends no payment for one left to collect", () => {
    expect(toPackageFields(toPackageValues(undefined, "c1"), undefined).payment).toBeUndefined();
  });

  it("never sends a payment with an edit: it is recorded as itself", () => {
    const paid = pkg({ paid: PAID, owedCents: 0 });
    expect(toPackageFields(toPackageValues(paid), paid)).toEqual({});
    expect(toPackageFields({ ...toPackageValues(paid), paidBy: "tng" }, paid).payment).toBeUndefined();
  });

  it("moves the payment to a new price only when asked", () => {
    const paid = pkg({ paid: PAID, owedCents: 0 });
    expect(toPackageFields({ ...toPackageValues(paid), price: "900" }, paid)).toEqual({ priceCents: 90000 });
    expect(toPackageFields({ ...toPackageValues(paid), price: "900", updatePayment: true }, paid)).toEqual({
      priceCents: 90000,
      updatePayment: true,
    });
    // Nothing to move without a new price.
    expect(toPackageFields({ ...toPackageValues(paid), updatePayment: true }, paid)).toEqual({});
  });
});
