import { describe, expect, it } from "vitest";
import { feeStartError, feesChanged, toClientFields, toClientValues, toFeeRates } from "./clients.form";
import type { ClientView } from "./clients.types";

const client = (feeRates: ClientView["feeRates"] = []): ClientView => ({
  id: "c1",
  name: "Jane",
  can: { archive: { ok: true }, unarchive: { ok: false }, delete: { ok: true } },
  aliases: [],
  feeRates,
  homeVisits: false,
});

describe("toFeeRates", () => {
  it("starts the first fee from the start, whatever date it had", () => {
    expect(
      toFeeRates([
        { from: "2026-01-01", amount: "90" },
        { from: "2026-10-01", amount: "100.50" },
      ]),
    ).toEqual([{ cents: 9000 }, { from: "2026-10-01", cents: 10050 }]);
  });
});

describe("feesChanged", () => {
  it("ignores the order the rows are in", () => {
    const saved = client([{ cents: 9000 }, { from: "2026-10-01", cents: 10000 }]);
    expect(feesChanged(saved, [{ from: "2026-10-01", cents: 10000 }, { cents: 9000 }])).toBe(false);
    expect(feesChanged(saved, [{ cents: 9000 }])).toBe(true);
    expect(feesChanged(client(), [])).toBe(false);
  });
});

describe("feeStartError", () => {
  const fees = [
    { from: "", amount: "90" },
    { from: "2026-10-01", amount: "100" },
    { from: "2026-10-01", amount: "110" },
  ];
  it("needs a day of its own after the first row", () => {
    expect(feeStartError(fees, 0, "")).toBeUndefined();
    expect(feeStartError(fees, 1, "")).toBe("Choose the day it starts");
    expect(feeStartError(fees, 2, "2026-10-01")).toBe("Another fee starts that day");
    expect(feeStartError(fees, 2, "2026-11-01")).toBeUndefined();
  });
});

describe("toClientFields", () => {
  it("sends the IC or passport number only when it changed, and an empty one to clear it", () => {
    const saved = { ...client(), idNo: "900101-14-5678" };
    const values = toClientValues(saved, undefined);
    expect(toClientFields(values, saved, undefined)).toEqual({});
    expect(toClientFields({ ...values, idNo: " A1234567 " }, saved, undefined)).toEqual({ idNo: "A1234567" });
    expect(toClientFields({ ...values, idNo: "" }, saved, undefined)).toEqual({ idNo: "" });
  });
});
