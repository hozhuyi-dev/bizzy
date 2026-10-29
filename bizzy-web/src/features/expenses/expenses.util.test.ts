import { describe, expect, it } from "vitest";
import { itemSuggestions, linesCategories, linesSummary, totalsByCategory, vendorSuggestions } from "./expenses.util";
import type { CatalogueView, ExpenseView } from "./expenses.types";
import { formatCents } from "~/core/utils/money.util";

const expense = (vendor: string, lines: Array<[string, string, number]>): ExpenseView => ({
  id: vendor,
  date: "2026-10-12",
  vendor,
  lines: lines.map(([name, categoryId, amountCents]) => ({ name, categoryId, amountCents })),
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
  items: [
    { id: "1", name: "Kinesio tape", categoryId: "purchases", lastAmountCents: 2500 },
    { id: "2", name: "Gel", categoryId: "purchases" },
    { id: "3", name: "Old", categoryId: "travel", archived: true },
  ],
  vendors: [
    { id: "1", name: "Shopee", lastUsed: "2026-10-09" },
    { id: "2", name: "Typo", lastUsed: "2026-10-08", archived: true },
    { id: "3", name: "Petronas", lastUsed: "2026-09-01" },
  ],
};

describe("expenses util", () => {
  it("names each category's total, largest first, leaving unused ones out", () => {
    const byCategory = { travel: 8900, purchases: 10200, rental: 0 };
    expect(totalsByCategory(byCategory, catalogue).map(({ category, cents }) => [category.id, cents])).toEqual([
      ["purchases", 10200],
      ["travel", 8900],
    ]);
  });

  it("suggests vendors as the API orders them, leaving archived ones out", () => {
    expect(vendorSuggestions(catalogue).map((s) => s.value)).toEqual(["Shopee", "Petronas"]);
  });

  it("suggests items by name, with their category and last price", () => {
    expect(itemSuggestions(catalogue)).toEqual([
      { value: "Gel", detail: "Purchases" },
      { value: "Kinesio tape", detail: `Purchases · ${formatCents(2500)}` },
    ]);
  });

  it("summarises a receipt's lines", () => {
    const receipt = expense("Shopee", [["Tape", "purchases", 4500], ["Gel", "purchases", 1200], ["Bag", "travel", 900]]);
    expect(linesSummary(receipt)).toBe("Tape, Gel +1");
  });
});

describe("linesCategories", () => {
  it("names each category once, in line order, skipping unknown ones", () => {
    const receipt = expense("Shopee", [["Tape", "purchases", 4500], ["Bag", "travel", 900], ["Gel", "purchases", 1200], ["X", "gone", 1]]);
    expect(linesCategories(receipt, catalogue)).toBe("Purchases, Travel");
    expect(linesCategories(receipt, undefined)).toBe("");
  });
});
