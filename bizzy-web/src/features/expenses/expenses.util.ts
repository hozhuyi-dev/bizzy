import type { CatalogueView, CategoryTotal, ExpenseView, SearchExpensesRequest } from "./expenses.types";
import type { Facet, ListFilter } from "~/core/filter/filter.types";
import { listRequest } from "~/core/filter/filter.util";

/** A calendar year as days, both included: the tax year in Malaysia. */
export function yearRange(year: number): { from: string; to: string } {
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

/** The API's totals by category id as the categories, largest first, unused ones left out. */
export function totalsByCategory(byCategory: Readonly<Record<string, number>>, catalogue: CatalogueView): Array<CategoryTotal> {
  return catalogue.categories
    .flatMap((category) => {
      const total = byCategory[category.id];
      return total ? [{ category, cents: total }] : [];
    })
    .sort((a, b) => b.cents - a.cents);
}

/** What the expenses list can be narrowed by (EXPENSE_FACETS): the categories, archived ones too. */
export function expenseFacets(catalogue: CatalogueView | undefined): Array<Facet> {
  const categories = catalogue?.categories ?? [];
  return [{ key: "category", label: "Category", options: categories.map(({ id, name }) => ({ value: id, label: name })) }];
}

/** The search the filter asks the API for. */
export function searchExpensesRequest(filter: ListFilter): SearchExpensesRequest {
  return { ...listRequest(filter), categoryIds: [...(filter.chips.category ?? [])] };
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
