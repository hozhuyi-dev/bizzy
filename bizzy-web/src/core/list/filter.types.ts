/**
 * A stretch of days, as the URL writes it: "2026" (a year), "2026-10" (a
 * month), "2026-10-05" (a day), or "2026-10-01~2026-12-31" (days, both
 * included).
 */
export type When = string;

/**
 * What a list is filtered by: words, a stretch of days, and chips. A row
 * shows when it has every word, is in the days, and matches one chip of
 * each facet that has any.
 */
export interface ListFilter {
  text: string;
  /** Undefined: all time. */
  when: When | undefined;
  /** The chips, as each facet's values, by facet key. */
  chips: Readonly<Record<string, ReadonlyArray<string>>>;
}

/** One kind of chip a list can be narrowed by: a client, a stage. */
export interface Facet {
  /** Its name in the URL and the filter: "client". */
  key: string;
  /** "Client", shown on its chips. */
  label: string;
  options: ReadonlyArray<FacetOption>;
  /** One chip at most: choosing another replaces it. */
  single?: boolean | undefined;
}

export interface FacetOption {
  value: string;
  label: string;
  /** Other words it is found by: a client's aliases. */
  keywords?: ReadonlyArray<string> | undefined;
}

/**
 * A list's filter as its route's URL keeps it, leaving out the defaults:
 * no words, no chips, and the page's own days ("all" for all time when
 * the page has a default).
 */
export type FilterSearch<TKey extends string> = {
  q?: string | undefined;
  when?: string | undefined;
} & { [P in TKey]?: Array<string> | undefined };

/** What every search route takes besides its own filters; mirrors listing.Request. */
export interface ListRequest {
  text: string;
  /** Days, YYYY-MM-DD, both included; unset leaves that end open. */
  from?: string | undefined;
  to?: string | undefined;
  /** Where the page starts: the page before's next. */
  after?: string | undefined;
  limit?: number | undefined;
}

/** A page of a list; mirrors listing.Page. */
export interface Page<T> {
  items: Array<T>;
  /** Reads the page after; unset on the last. */
  next?: string;
}
