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
    expect(toPackageFields(toPackageValues(pkg()), pkg()).payment).toBeUndefined();
  });

  it("sends nothing of a payment left as it was", () => {
    const paid = pkg({ paid: PAID, owedCents: 0 });
    expect(toPackageFields(toPackageValues(paid), paid)).toEqual({});
  });

  it("records the payment again on another day", () => {
    const paid = pkg({ paid: PAID, owedCents: 0 });
    const values = { ...toPackageValues(paid), paidOn: "2026-10-05" };
    expect(toPackageFields(values, paid).payment).toEqual({ payment: { method: "cash", paidOn: "2026-10-05" } });
  });

  it("records the payment again with a new price, which it follows", () => {
    const paid = pkg({ paid: PAID, owedCents: 0 });
    const values = { ...toPackageValues(paid), price: "900" };
    expect(toPackageFields(values, paid)).toEqual({
      priceCents: 90000,
      payment: { payment: { method: "cash", paidOn: "2026-10-02" } },
    });
  });

  it("undoes the payment once it is set back to not paid", () => {
    const paid = pkg({ paid: PAID, owedCents: 0 });
    const values = { ...toPackageValues(paid), paidBy: "" as const };
    expect(toPackageFields(values, paid).payment).toEqual({});
  });

  it("leaves a payment an issued receipt records alone", () => {
    const issued = pkg({
      paid: { ...PAID, issued: true, receiptNumber: "R-0001" },
      owedCents: 0,
      locked: { payment: { ok: false, why: "R-0001 records its payment." } },
    });
    const values = { ...toPackageValues(issued), paidBy: "" as const };
    expect(toPackageFields(values, issued).payment).toBeUndefined();
  });
});
