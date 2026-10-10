import { centsToInput, formatCents, parseCents } from "./money.util";

describe("parseCents", () => {
  test.each([
    ["95", 9500],
    ["95.5", 9550],
    ["95.05", 9505],
    ["RM95.50", 9550],
    ["rm 95", 9500],
    [" 120 ", 12000],
    ["0", 0],
  ])("parses %j", (input, expected) => {
    expect(parseCents(input)).toBe(expected);
  });

  test.each(["", "abc", "95.555", "-5", "1,000", "95."])(
    "rejects %j",
    (input) => {
      expect(parseCents(input)).toBeNull();
    },
  );
});

describe("centsToInput", () => {
  test.each([
    [undefined, ""],
    [9500, "95"],
    [9550, "95.50"],
    [9505, "95.05"],
  ])("renders %j", (cents, expected) => {
    expect(centsToInput(cents)).toBe(expected);
  });

  test("round-trips through parseCents", () => {
    expect(parseCents(centsToInput(12345))).toBe(12345);
  });
});

describe("formatCents", () => {
  test("formats as currency", () => {
    // ICU may separate "RM" with a non-breaking space.
    expect(formatCents(9550)).toMatch(/^RM\s?95\.50$/);
  });
});
