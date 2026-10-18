import { describe, expect, it } from "vitest";
import { linesSummary, totalsByCategory, vendorsOf, yearRange } from "./expenses.util";
import type { CatalogueView, ExpenseView } from "./expenses.types";

const expense = (vendor: string, lines: Array<[string, string, number]>): ExpenseView => ({
  id: vendor,
  date: "2026-10-12",
  vendor,
  lines: lines.map(([name, categoryId, amountCents]) => ({ itemId: name, name, categoryId, amountCents })),
  totalCents: lines.reduce((sum, [, , cents]) => sum + cents, 0),
  files: 0,
  createdAt: "",
  updatedAt: "",
});

const catalogue: CatalogueView = {
  categories: [
    { id: "purchases", name: "Purchases" },
    { id: "travel", name: "Travel" },
    { id: "rental", name: "Rental" },
  ],
  items: [],
};

describe("expenses util", () => {
  const year = [
    expense("Shopee", [["Tape", "purchases", 4500], ["Gel", "purchases", 1200], ["Bag", "travel", 900]]),
    expense("Petronas", [["Fuel", "travel", 8000]]),
    expense("Shopee", [["Tape", "purchases", 4500]]),
  ];

  it("sums each category's lines, largest first, leaving unused ones out", () => {
    expect(totalsByCategory(year, catalogue).map(({ category, cents }) => [category.id, cents])).toEqual([
      ["purchases", 10200],
      ["travel", 8900],
    ]);
  });

  it("suggests where she buys most often first", () => {
    expect(vendorsOf(year)).toEqual(["Shopee", "Petronas"]);
  });

  it("summarises a receipt's lines", () => {
    expect(linesSummary(year[0] as ExpenseView)).toBe("Tape, Gel +1");
    expect(yearRange(2026)).toEqual({ from: "2026-01-01", to: "2026-12-31" });
  });
});
