import type { CatalogueView, CategoryTotal, ExpenseView } from "./expenses.types";

/** A calendar year as days, both included: the tax year in Malaysia. */
export function yearRange(year: number): { from: string; to: string } {
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

/** What a receipt's lines add up to in each category, largest first, unused ones left out. */
export function totalsByCategory(expenses: ReadonlyArray<ExpenseView>, catalogue: CatalogueView): Array<CategoryTotal> {
  const cents = new Map<string, number>();
  for (const expense of expenses) {
    for (const line of expense.lines) {
      cents.set(line.categoryId, (cents.get(line.categoryId) ?? 0) + line.amountCents);
    }
  }
  return catalogue.categories
    .flatMap((category) => {
      const total = cents.get(category.id);
      return total ? [{ category, cents: total }] : [];
    })
    .sort((a, b) => b.cents - a.cents);
}

/** "Kinesio tape, Gel +2": what a receipt was for, at a glance. */
export function linesSummary(expense: ExpenseView, shown = 2): string {
  const names = expense.lines.map((line) => line.name);
  const more = names.length - shown;
  return names.slice(0, shown).join(", ") + (more > 0 ? ` +${more}` : "");
}

/** Where she has bought things, most often first, to suggest as she types. */
export function vendorsOf(expenses: ReadonlyArray<ExpenseView>): Array<string> {
  const counts = new Map<string, number>();
  for (const { vendor } of expenses) {
    if (vendor) counts.set(vendor, (counts.get(vendor) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([vendor]) => vendor);
}

/** Item names compare however she typed them, as the API does. */
export function normalizeName(name: string): string {
  return name.trim().split(/\s+/).join(" ").toLowerCase();
}
