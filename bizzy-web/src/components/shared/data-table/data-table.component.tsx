import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";
import { cn } from "cn";
import { searchItems, toFields } from "./data-table-search.util";
import type { ReactNode } from "react";
import type { ReactTable, Row, RowData } from "@tanstack/react-table";
import type { DataTableFeatures } from "./data-table.config";
import type { SearchText } from "./data-table.types";
import { EmptyState } from "~/components/shared/quip/quip.component";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { QUIPS } from "~/core/constants/quips.constant";

interface DataTableProps<TData extends RowData> {
  table: ReactTable<DataTableFeatures, TData>;
  /** Phone layout: each row as a stacked card instead of a table row. */
  renderCard: (row: Row<DataTableFeatures, TData>) => ReactNode;
  /** Shown in place of the rows; usually an EmptyState. */
  empty: ReactNode;
  /** Words to find rows by, across every column; see data-table.search. */
  query?: string | undefined;
}

/**
 * Renders a table on wider screens and cards on phones. Both views read the
 * same row model, so sorting and selection behave identically in each.
 */
export function DataTable<TData extends RowData>({
  table,
  renderCard,
  empty: emptyContent,
  query = "",
}: DataTableProps<TData>) {
  const allRows = table.getRowModel().rows;
  const rows = query.trim() ? searchItems(allRows, query, rowFields) : allRows;
  const empty = (
    <div className="py-10 whitespace-normal">
      {allRows.length > 0 ? (
        <EmptyState quips={QUIPS.search}>No matches for “{query.trim()}”.</EmptyState>
      ) : (
        emptyContent
      )}
    </div>
  );

  return (
    <>
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id}>
                {group.headers.map((header) => {
                  const { column } = header;
                  const sorted = column.getIsSorted();
                  return (
                    <TableHead key={header.id} aria-sort={ariaSort(column.getCanSort(), sorted)}>
                      {header.isPlaceholder ? null : column.getCanSort() ? (
                        <button
                          type="button"
                          className="group/sort inline-flex cursor-pointer items-center gap-1 rounded-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                          onClick={column.getToggleSortingHandler()}
                        >
                          <table.FlexRender header={header} />
                          <SortArrow direction={sorted || column.getNextSortingOrder()} active={sorted !== false} />
                        </button>
                      ) : (
                        <table.FlexRender header={header} />
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {/* An empty table keeps its header, so the page doesn't jump. */}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={table.getAllLeafColumns().length}>{empty}</TableCell>
              </TableRow>
            )}
            {rows.map((row) => (
              <TableRow
                key={row.id}
                data-state={row.getIsSelected() ? "selected" : undefined}
              >
                {row.getAllCells().map((cell) => (
                  <TableCell key={cell.id}>
                    <table.FlexRender cell={cell} />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ul className="flex flex-col gap-2 md:hidden">
        {rows.length === 0 && <li>{empty}</li>}
        {rows.map((row) => (
          <li key={row.id}>{renderCard(row)}</li>
        ))}
      </ul>
    </>
  );
}

/**
 * Like a Material sort header: a sorted column shows its direction; any other
 * sortable column hints, on hover or focus, the direction its first click
 * sorts. The arrow always keeps its space, so the label never shifts.
 */
function SortArrow({ direction, active }: { direction: false | "asc" | "desc"; active: boolean }) {
  const Icon = direction === "desc" ? ArrowDownIcon : ArrowUpIcon;
  return (
    <Icon
      aria-hidden="true"
      className={cn(
        "size-3.5 transition-opacity",
        active
          ? "opacity-100"
          : "opacity-0 group-hover/sort:opacity-40 group-focus-visible/sort:opacity-40",
      )}
    />
  );
}

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

function ariaSort(canSort: boolean, direction: false | "asc" | "desc") {
  if (!canSort) return undefined;
  if (direction === "asc") return "ascending";
  if (direction === "desc") return "descending";
  return "none";
}
