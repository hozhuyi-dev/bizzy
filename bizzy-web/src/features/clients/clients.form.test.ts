import { describe, expect, it } from "vitest";
import { toClientFields, toClientValues } from "./clients.form";
import type { ClientView } from "./clients.types";

const client = (feeCents?: number): ClientView => ({
  id: "c1",
  name: "Jane",
  can: { archive: { ok: true }, unarchive: { ok: false }, delete: { ok: true } },
  aliases: [],
  ...(feeCents === undefined ? {} : { feeCents }),
  homeVisits: false,
});

describe("toClientFields", () => {
  it("sends the IC or passport number only when it changed, and an empty one to clear it", () => {
    const saved = { ...client(), idNo: "900101-14-5678" };
    const values = toClientValues(saved, undefined);
    expect(toClientFields(values, saved, undefined)).toEqual({});
    expect(toClientFields({ ...values, idNo: " A1234567 " }, saved, undefined)).toEqual({ idNo: "A1234567" });
    expect(toClientFields({ ...values, idNo: "" }, saved, undefined)).toEqual({ idNo: "" });
  });

  it("sends the fee only when it changed, and an empty one to clear it", () => {
    const saved = client(9000);
    const values = toClientValues(saved, undefined);
    expect(values.fee).toBe("90");
    expect(toClientFields(values, saved, undefined)).toEqual({});
    expect(toClientFields({ ...values, fee: "95.50" }, saved, undefined)).toEqual({ fee: { cents: 9550 } });
    expect(toClientFields({ ...values, fee: "" }, saved, undefined)).toEqual({ fee: {} });
  });

  it("sends no fee for a new client without one", () => {
    expect(toClientFields(toClientValues(undefined, "Jane"), undefined, undefined)).not.toHaveProperty("fee");
  });
});
