import {
  createColumnHelper,
  createSortedRowModel,
  metaHelper,
  rowSelectionFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  sortFn_datetime,
  tableFeatures,
} from "@tanstack/react-table";
import type { RowData } from "@tanstack/react-table";
import type { SearchText } from "./data-table.search";

/** What a column adds to the table's features. */
export interface DataTableColumnMeta {
  /**
   * The text she would type to find a row by this column, as it is shown
   * (formatted dates and amounts, names). Without it a column is searched by
   * its value when that is text. Typed loosely here; each column's own
   * function takes that table's row.
   */
  search?: (row: never) => SearchText;
}

/**
 * One feature set for every list in the app, so the shared DataTable can rely
 * on sorting and selection APIs being present. Data is small (one practice),
 * so everything is sorted in the browser.
 */
export const dataTableFeatures = tableFeatures({
  rowSortingFeature,
  rowSelectionFeature,
  sortedRowModel: createSortedRowModel(),
  columnMeta: metaHelper<DataTableColumnMeta>(),
  sortFns: {
    alphanumeric: sortFn_alphanumeric,
    basic: sortFn_basic,
    datetime: sortFn_datetime,
  },
});

export type DataTableFeatures = typeof dataTableFeatures;

export function createDataTableColumnHelper<TData extends RowData>() {
  return createColumnHelper<DataTableFeatures, TData>();
}
