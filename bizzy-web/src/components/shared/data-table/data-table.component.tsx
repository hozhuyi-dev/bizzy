import { useEffect, useRef, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";
import { cn } from "cn";
import { opensRow } from "./data-table-row.util";
import { shownRows } from "./data-table-search.util";
import type { MouseEvent, ReactNode, RefObject } from "react";
import type { LinkOptions } from "@tanstack/react-router";
import type { ReactTable, Row, RowData } from "@tanstack/react-table";
import type { DataTableFeatures } from "./data-table.config";
import type { DataTableColumnMeta } from "./data-table.types";
import { EmptyState } from "~/components/shared/quip/quip.component";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/components/ui/table";
import { QUIPS } from "~/core/constants/quips.constant";

interface DataTableProps<TData extends RowData> {
  table: ReactTable<DataTableFeatures, TData>;
  /** Phone layout: each row as a card instead of a table row; a DataCard, so every card is one height. */
  renderCard: (row: Row<DataTableFeatures, TData>) => ReactNode;
  /** Shown in place of the rows; usually an EmptyState. */
  empty: ReactNode;
  /** Words to find rows by, across every column; see data-table.search. */
  query?: string | undefined;
  /** The row's page: a click anywhere on the row opens it (its card has its own `open`). */
  rowLink?: ((row: TData) => LinkOptions) | undefined;
  /** For a row without a page: what a click anywhere on it does instead, e.g. open it to edit. */
  onRowOpen?: ((row: TData) => void) | undefined;
}

/**
 * Renders a table on wider screens and cards on phones. Both views read the
 * same row model, so sorting and selection behave identically in each.
 * Every row is one height (cells show a line and a quieter one under it,
 * see CellText), so a list never shifts as rows load or change.
 *
 * The header sticks under the page header while the rows scroll by. A
 * table too wide for the screen scrolls sideways instead, and its header
 * then scrolls away with it: a sticky header can't stick inside a box that
 * scrolls.
 */
export function DataTable<TData extends RowData>({
  table,
  renderCard,
  empty: emptyContent,
  query = "",
  rowLink,
  onRowOpen,
}: DataTableProps<TData>) {
  const router = useRouter();
  const container = useRef<HTMLDivElement>(null);
  const tableElement = useRef<HTMLTableElement>(null);
  const tooWide = useTooWide(container, tableElement);
  const allRows = table.getRowModel().rows;
  const rows = shownRows(table, query);
  const emptyState =
    allRows.length > 0 ? <EmptyState quips={QUIPS.search}>No matches for “{query.trim()}”.</EmptyState> : emptyContent;

  /**
   * A click on the row that isn't on something of its own (see opensRow)
   * opens the row's page; with Ctrl or ⌘, in a new tab. The row's first
   * link stays the way there by keyboard.
   */
  const openRow = (event: MouseEvent<HTMLTableRowElement>, data: TData) => {
    if (!opensRow(event.target as Element, event.currentTarget, window.getSelection()?.toString() ?? "")) return;
    if (!rowLink) {
      onRowOpen?.(data);
      return;
    }
    const link = rowLink(data);
    if (event.ctrlKey || event.metaKey) window.open(router.buildLocation(link).href, "_blank", "noopener");
    else void router.navigate(link);
  };

  return (
    <>
      <div
        ref={container}
        className={cn(
          "hidden rounded-xl bg-card ring-1 ring-foreground/10 md:block",
          tooWide ? "overflow-x-auto" : "overflow-clip",
        )}
      >
        <table ref={tableElement} data-slot="table" className="w-full caption-bottom text-sm">
          <TableHeader className={cn("bg-muted", !tooWide && "sticky top-(--sticky-top) z-10")}>
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id} className="hover:bg-transparent">
                {group.headers.map((header) => {
                  const { column } = header;
                  const sorted = column.getIsSorted();
                  return (
                    <TableHead
                      key={header.id}
                      aria-sort={ariaSort(column.getCanSort(), sorted)}
                      className={cn(HEAD, columnClass(column.columnDef.meta))}
                    >
                      {header.isPlaceholder ? null : column.getCanSort() ? (
                        <button
                          type="button"
                          className="group/sort inline-flex cursor-pointer items-center gap-1 rounded-sm outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
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
            {/* One row high, each line cut short: the first row to come takes its place without a shift. */}
            {rows.length === 0 && (
              <TableRow className="h-14 hover:bg-transparent">
                <TableCell
                  colSpan={table.getAllLeafColumns().length}
                  className={cn(CELL, "max-w-0 [&_p]:max-w-full [&_p]:truncate")}
                >
                  {emptyState}
                </TableCell>
              </TableRow>
            )}
            {rows.map((row) => (
              <TableRow
                key={row.id}
                data-state={row.getIsSelected() ? "selected" : undefined}
                className={cn("h-14 hover:bg-muted/30", (rowLink || onRowOpen) && "cursor-pointer")}
                onClick={rowLink || onRowOpen ? (event) => openRow(event, row.original) : undefined}
              >
                {row.getAllCells().map((cell) => (
                  <TableCell key={cell.id} className={cn(CELL, columnClass(cell.column.columnDef.meta))}>
                    <table.FlexRender cell={cell} />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </table>
      </div>

      <ul className="flex flex-col gap-2 md:hidden">
        {rows.length === 0 && <li className="py-10">{emptyState}</li>}
        {rows.map((row) => (
          <li key={row.id}>{renderCard(row)}</li>
        ))}
      </ul>
    </>
  );
}

// Quiet small-caps-like headings on a tinted band; rows a fixed 56px, with
// room at the table's edges.
const HEAD = "h-9 px-3 text-xs font-medium text-muted-foreground first:pl-4 last:pr-4";
const CELL = "px-3 py-1.5 first:pl-4 last:pr-4";

/** Whether the table is wider than its box, as the screen or its rows change. */
function useTooWide(container: RefObject<HTMLElement | null>, table: RefObject<HTMLElement | null>): boolean {
  const [tooWide, setTooWide] = useState(false);
  useEffect(() => {
    const box = container.current;
    const inner = table.current;
    if (!box || !inner) return;
    const check = () => setTooWide(inner.offsetWidth > box.clientWidth + 1);
    const observer = new ResizeObserver(check);
    observer.observe(box);
    observer.observe(inner);
    return () => observer.disconnect();
  }, [container, table]);
  return tooWide;
}

/** How a column's meta lays out its header and cells. */
function columnClass(meta: DataTableColumnMeta | undefined): string {
  return cn(
    meta?.align === "end" && "text-right tabular-nums",
    // Takes the room left; its text is cut short rather than widening the table.
    meta?.width === "grow" && "w-full max-w-0 min-w-48",
    meta?.width === "fit" && "w-px",
    meta?.from === "lg" && "hidden lg:table-cell",
    meta?.from === "xl" && "hidden xl:table-cell",
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

function ariaSort(canSort: boolean, direction: false | "asc" | "desc") {
  if (!canSort) return undefined;
  if (direction === "asc") return "ascending";
  if (direction === "desc") return "descending";
  return "none";
}
