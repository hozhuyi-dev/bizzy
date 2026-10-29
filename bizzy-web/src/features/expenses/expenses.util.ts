import { CATALOGUE_FACET_KEYS, EXPENSE_FACETS } from "./expenses.constant";
import type { CatalogueView, CategoryTotal, ExpenseView, SearchExpensesRequest } from "./expenses.types";
import type { Suggestion } from "~/components/shared/form/autocomplete-input/autocomplete-input.component";
import type { Facet, FilterPreset, ListFilter } from "~/core/list/filter.types";
import type { Place } from "~/core/list/pager.types";
import { NO_FILTER, filterUrl, listRequest } from "~/core/list/filter.util";
import { formatCents } from "~/core/utils/money.util";
import { monthKey } from "~/core/utils/date.util";

/** The expenses list's filter in its URL: this year, the tax year, unless it says otherwise. */
export const expensesUrl = filterUrl(EXPENSE_FACETS, () => String(new Date().getFullYear()));

/** The receipts a shop or item is on, at any time: the expenses list with its chip. */
export function receiptsOf(chip: "vendor" | "item", name: string) {
  return { to: "/expenses", search: expensesUrl.toSearch({ ...NO_FILTER, chips: { [chip]: [name] } }) } as const;
}

/** The items' or shops' list filter in its URL. */
export const catalogueUrl = filterUrl(CATALOGUE_FACET_KEYS);

/** What the items' and shops' lists can be narrowed by besides words. */
export const CATALOGUE_FACETS: ReadonlyArray<Facet> = [
  { key: "archived", label: "Archived", single: true, options: [{ value: "yes", label: "Archived" }] },
];

/** The ways the items' and shops' lists are looked at: those still suggested first, as they open. */
export const CATALOGUE_PRESETS: ReadonlyArray<FilterPreset> = [
  { label: "In use", when: undefined, chips: {} },
  { label: "Archived", when: undefined, chips: { archived: ["yes"] } },
];

/** Whether the items' or shops' list, so filtered, lists the archived ones: only under their chip. */
export function listsArchived(filter: ListFilter): boolean {
  return Boolean(filter.chips.archived?.length);
}

/** Where an expense sits in the expenses list: by its day. */
export function expensePlace(expense: ExpenseView): Place {
  return { at: Date.parse(expense.date), id: expense.id };
}

/** Totals by category id as the categories, largest first, unused ones left out. */
export function totalsByCategory(byCategory: Readonly<Record<string, number>>, catalogue: CatalogueView): Array<CategoryTotal> {
  return catalogue.categories
    .flatMap((category) => {
      const total = byCategory[category.id];
      return total ? [{ category, cents: total }] : [];
    })
    .sort((a, b) => b.cents - a.cents);
}

/**
 * What the expenses list can be narrowed by (EXPENSE_FACETS): the
 * categories, shops and items, archived ones too, and whether the receipt
 * is kept.
 */
export function expenseFacets(catalogue: CatalogueView | undefined): Array<Facet> {
  const categories = catalogue?.categories ?? [];
  const vendors = catalogue?.vendors ?? [];
  const items = catalogue?.items ?? [];
  return [
    { key: "category", label: "Category", options: categories.map(({ id, name }) => ({ value: id, label: name })) },
    { key: "vendor", label: "Shop", options: vendors.map(({ name }) => ({ value: name, label: name })) },
    { key: "item", label: "Item", options: items.map(({ name }) => ({ value: name, label: name })) },
    {
      key: "receipt",
      label: "Receipt",
      single: true,
      options: [
        { value: "kept", label: "Receipt kept" },
        { value: "missing", label: "No receipt", keywords: ["missing"] },
      ],
    },
  ];
}

/** The ways the expenses list is usually looked at: the tax year first, as it opens. */
export function expensePresets(now = new Date()): Array<FilterPreset> {
  const year = String(now.getFullYear());
  return [
    { label: "This year", when: year, chips: {} },
    { label: "This month", when: monthKey(now), chips: {} },
    { label: "No receipt this year", when: year, chips: { receipt: ["missing"] } },
  ];
}

/** The search the filter asks the API for. */
export function searchExpensesRequest(filter: ListFilter): SearchExpensesRequest {
  return {
    ...listRequest(filter),
    categoryIds: [...(filter.chips.category ?? [])],
    vendors: [...(filter.chips.vendor ?? [])],
    items: [...(filter.chips.item ?? [])],
    receipts: [...(filter.chips.receipt ?? [])] as SearchExpensesRequest["receipts"],
  };
}

/** "Kinesio tape, Gel +2": what a receipt was for, at a glance. */
export function linesSummary(expense: ExpenseView, shown = 2): string {
  const names = expense.lines.map((line) => line.name);
  const more = names.length - shown;
  return names.slice(0, shown).join(", ") + (more > 0 ? ` +${more}` : "");
}

/** "Supplies, Equipment": the categories of a receipt's lines, each once, by name. */
export function linesCategories(expense: ExpenseView, catalogue: CatalogueView | undefined): string {
  const names = new Map((catalogue?.categories ?? []).map((category) => [category.id, category.name]));
  const ids = [...new Set(expense.lines.map((line) => line.categoryId))];
  return ids.flatMap((id) => names.get(id) ?? []).join(", ");
}

/** Where the user has bought from, last used first (as the API orders them), to suggest as they type. */
export function vendorSuggestions(catalogue: CatalogueView): Array<Suggestion> {
  return catalogue.vendors.filter((vendor) => !vendor.archived).map((vendor) => ({ value: vendor.name }));
}

/** "Kinesio tape · Purchases · RM 25.00": the items lines are picked from, with their category and last price. */
export function itemSuggestions(catalogue: CatalogueView): Array<Suggestion> {
  const categories = new Map(catalogue.categories.map((category) => [category.id, category.name]));
  return catalogue.items
    .filter((item) => !item.archived)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((item) => ({
      value: item.name,
      detail: [categories.get(item.categoryId), item.lastAmountCents === undefined ? undefined : formatCents(item.lastAmountCents)]
        .filter(Boolean)
        .join(" · "),
    }));
}

/** Item names compare however they were typed, as the API does. */
export function normalizeName(name: string): string {
  return name.trim().split(/\s+/).join(" ").toLowerCase();
}
