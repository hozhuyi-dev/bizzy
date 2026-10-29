import { describe, expect, it } from "vitest";
import { EMPTY_LINE, toExpenseFields, totalOf, withName } from "./expenses.form";
import type { CatalogueView } from "./expenses.types";

const catalogue: CatalogueView = {
  categories: [
    { id: "purchases", name: "Purchases and cost of production" },
    { id: "travel", name: "Travelling and transportation" },
  ],
  items: [{ id: "tape", name: "Kinesio tape", categoryId: "purchases", lastAmountCents: 4500 }],
  vendors: [],
};

describe("withName", () => {
  it("fills a listed item's category and last price, however the name is typed", () => {
    expect(withName({ ...EMPTY_LINE }, "kinesio  TAPE", catalogue)).toEqual({
      name: "kinesio  TAPE",
      categoryId: "purchases",
      amount: "45",
    });
  });

  it("keeps an amount already typed", () => {
    expect(withName({ ...EMPTY_LINE, amount: "40" }, "Kinesio tape", catalogue).amount).toBe("40");
  });

  it("makes a new name a new item, keeping the category chosen", () => {
    const line = { name: "Kinesio tape", categoryId: "travel", amount: "3" };
    expect(withName(line, "Parking", catalogue)).toEqual({ ...line, name: "Parking" });
  });

  it("keeps a saved line's own category while its name is only retyped", () => {
    const line = { name: "Kinesio tape", categoryId: "travel", amount: "3" };
    expect(withName(line, "Kinesio Tape", catalogue)).toEqual({ ...line, name: "Kinesio Tape" });
  });
});

describe("toExpenseFields", () => {
  it("sends each line as typed", () => {
    const input = toExpenseFields({
      date: "2026-10-12",
      vendor: "Shopee",
      notes: " ",
      lines: [
        { name: "Kinesio tape", categoryId: "purchases", amount: "45" },
        { name: "Parking", categoryId: "travel", amount: "3.50" },
      ],
    });
    expect(input).toEqual({
      date: "2026-10-12",
      vendor: "Shopee",
      notes: "",
      lines: [
        { name: "Kinesio tape", categoryId: "purchases", amountCents: 4500 },
        { name: "Parking", categoryId: "travel", amountCents: 350 },
      ],
    });
    expect(totalOf([{ ...EMPTY_LINE, amount: "45" }, { ...EMPTY_LINE, amount: "oops" }])).toBe(4500);
  });
});
