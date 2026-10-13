import { describe, expect, it } from "vitest";
import { EMPTY_LINE, toExpenseInput, totalOf, withName } from "./expenses.form";
import type { Catalogue } from "./expenses.types";

const catalogue: Catalogue = {
  categories: [
    { id: "purchases", name: "Purchases and cost of production" },
    { id: "travel", name: "Travelling and transportation" },
  ],
  items: [{ id: "tape", name: "Kinesio tape", categoryId: "purchases", lastAmountCents: 4500 }],
};

describe("withName", () => {
  it("fills a listed item's category and last price, however the name is typed", () => {
    expect(withName({ ...EMPTY_LINE }, "kinesio  TAPE", catalogue)).toEqual({
      itemId: "tape",
      name: "kinesio  TAPE",
      categoryId: "purchases",
      amount: "45",
    });
  });

  it("keeps an amount already typed", () => {
    expect(withName({ ...EMPTY_LINE, amount: "40" }, "Kinesio tape", catalogue).amount).toBe("40");
  });

  it("makes a new name a new item, keeping the category chosen", () => {
    const line = { itemId: "tape", name: "Kinesio tape", categoryId: "travel", amount: "3" };
    expect(withName(line, "Parking", catalogue)).toEqual({ ...line, itemId: "", name: "Parking" });
  });
});

describe("toExpenseInput", () => {
  it("sends new items without an id, and the version edited", () => {
    const input = toExpenseInput(
      {
        date: "2026-10-12",
        vendor: "Shopee",
        notes: " ",
        lines: [
          { itemId: "tape", name: "Kinesio tape", categoryId: "purchases", amount: "45" },
          { itemId: "", name: "Parking", categoryId: "travel", amount: "3.50" },
        ],
      },
      undefined,
    );
    expect(input).toEqual({
      version: 0,
      date: "2026-10-12",
      vendor: "Shopee",
      notes: "",
      lines: [
        { itemId: "tape", name: "Kinesio tape", categoryId: "purchases", amountCents: 4500 },
        { name: "Parking", categoryId: "travel", amountCents: 350 },
      ],
    });
    expect(totalOf([{ ...EMPTY_LINE, amount: "45" }, { ...EMPTY_LINE, amount: "oops" }])).toBe(4500);
  });
});
