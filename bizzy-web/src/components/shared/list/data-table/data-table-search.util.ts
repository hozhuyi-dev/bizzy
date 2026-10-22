import type { ReactTable, Row, RowData } from "@tanstack/react-table";
import type { DataTableFeatures } from "./data-table.config";
import type { SearchText } from "~/core/list/text-search.util";
import { searchItems, toFields } from "~/core/list/text-search.util";

/** Each column's searchable text for a row: its search function, else its text value. */
function rowFields<TData extends RowData>(row: Row<DataTableFeatures, TData>): Array<string> {
  return toFields(
    row.getAllCells().map((cell): SearchText => {
      const search = cell.column.columnDef.meta?.search as ((row: TData) => SearchText) | undefined;
      if (search) return search(row.original);
      const value = cell.getValue();
      return typeof value === "string" ? value : undefined;
    }),
  );
}

/**
 * The rows a DataTable shows: in its order, or best match first for words
 * searched in every column. A list stepped through outside the table
 * (a client's page) reads the same.
 */
export function shownRows<TData extends RowData>(
  table: ReactTable<DataTableFeatures, TData>,
  query: string,
): Array<Row<DataTableFeatures, TData>> {
  const rows = table.getRowModel().rows;
  return query.trim() ? searchItems(rows, query, rowFields) : rows;
}
