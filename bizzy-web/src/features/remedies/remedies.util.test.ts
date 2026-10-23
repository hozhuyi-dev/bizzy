import { describe, expect, test } from "vitest";
import { saidAbove } from "./remedies.util";

describe("saidAbove", () => {
  const issued = { ok: false, why: "INV260001 is issued." };

  test("a reason a field above gave is said once", () => {
    expect(saidAbove({ ...issued }, undefined, issued)).toBe(true);
  });

  test("a new reason, or no lock, is not", () => {
    expect(saidAbove({ ok: false, why: "It is paid." }, issued)).toBe(false);
    expect(saidAbove(undefined, issued)).toBe(false);
    expect(saidAbove(issued)).toBe(false);
  });
});
