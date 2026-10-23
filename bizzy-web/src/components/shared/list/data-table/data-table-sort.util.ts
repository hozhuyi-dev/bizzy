import type { OnChangeFn, SortingState } from "@tanstack/react-table";
import type { ListFilter } from "~/core/list/filter.types";

/**
 * The sorting a list's `sort` says, or the list's own (`fallback`) when it
 * says none or names a column the table hasn't got.
 */
export function toSorting(sort: string | undefined, fallback: SortingState, columnIds: ReadonlyArray<string>): SortingState {
  if (!sort) return fallback;
  const desc = sort.startsWith("-");
  const id = desc ? sort.slice(1) : sort;
  return columnIds.includes(id) ? [{ id, desc }] : fallback;
}

/** The `sort` that keeps a sorting in the URL: none for the list's own, so its URL stays clean. */
export function fromSorting(sorting: SortingState, fallback: SortingState): string | undefined {
  const [first] = sorting;
  const [own] = fallback;
  if (!first || (own && own.id === first.id && own.desc === first.desc)) return undefined;
  return `${first.desc ? "-" : ""}${first.id}`;
}

/** The ids of a table's columns, as defined: their id, or the key they read. */
export function columnIdsOf(columns: ReadonlyArray<{ id?: string | undefined }>): Array<string> {
  return columns.flatMap((column) => {
    const id = column.id ?? (column as { accessorKey?: unknown }).accessorKey;
    return typeof id === "string" ? [id] : [];
  });
}

/**
 * A list loaded whole, sorted as its filter says: the table's sorting
 * options, kept in the filter (so in the URL) instead of in the table. Back
 * returns to it sorted the same, and an item's page steps through it in
 * that order. Clicking a column flips it between its two ways; there is no
 * unsorted third.
 */
export function sortingFromFilter(
  filter: ListFilter,
  onFilterChange: (filter: ListFilter) => void,
  fallback: SortingState,
  columns: ReadonlyArray<{ id?: string | undefined }>,
): { state: { sorting: SortingState }; onSortingChange: OnChangeFn<SortingState>; enableSortingRemoval: false } {
  const sorting = toSorting(filter.sort, fallback, columnIdsOf(columns));
  return {
    state: { sorting },
    onSortingChange: (updater) => {
      const next = typeof updater === "function" ? updater(sorting) : updater;
      onFilterChange({ ...filter, sort: fromSorting(next, fallback) });
    },
    enableSortingRemoval: false,
  };
}
