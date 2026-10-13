/** What a column offers the search: one or more pieces of text, as shown. */
export type SearchText = string | number | null | undefined | ReadonlyArray<string | number | null | undefined>;

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
