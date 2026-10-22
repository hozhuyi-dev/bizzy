import type { SearchText } from "~/core/list/text-search.util";

/** What a column adds to the table's features. */
export interface DataTableColumnMeta {
  /**
   * The text the user would type to find a row by this column, as it is
   * shown (formatted dates and amounts, names). Without it a column is
   * searched by its value when that is text. Typed loosely here; each
   * column's own function takes that table's row.
   */
  search?: (row: never) => SearchText;
  /** "end" for amounts and figures, so their digits line up on the right. */
  align?: "start" | "end";
  /**
   * "grow" takes the room the others leave and cuts its text short (a
   * summary, a name); "fit" shrinks to its content (the actions). Others
   * size to their content and never wrap.
   */
  width?: "grow" | "fit";
  /** Shown only from this screen width up: a column that can go when room is short. */
  from?: "lg" | "xl";
}
