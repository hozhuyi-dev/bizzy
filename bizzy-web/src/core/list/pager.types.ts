import type { Facet, ListFilter } from "./filter.types";

/** Which way along a list: towards its top, or its bottom. */
export type Side = "before" | "after";

/**
 * An item's place in a list as the API orders it, latest first: by its
 * main time, then by its id (mirrors table.Place, read descending).
 */
export interface Place {
  /** Milliseconds; -Infinity for none yet (a draft's date), which sorts last. */
  at: number;
  id: string;
}

/** What of a list is loaded, as a window onto the whole of it. */
export interface WindowState<T> {
  /** The items loaded, in the list's order, with none missing between them. */
  items: ReadonlyArray<T>;
  /**
   * There are items above the first loaded one, so its place in the whole
   * list isn't known. Always false while lists are read from the top; a
   * list opened at an item (a read backwards from it) has some.
   */
  hasBefore: boolean;
  /** There are items below the last loaded one. */
  hasAfter: boolean;
}

/** A list an entity's page steps through, loaded a page at a time or all at once. */
export interface ListWindow<T> extends WindowState<T> {
  /** Nothing to go by yet: the first page, or a new filter's, is loading. */
  pending: boolean;
  /** A page is loading on one side. */
  loading: boolean;
  /** Reads the next page on a side; resolves to the window as it is then. */
  load: (side: Side) => Promise<WindowState<T>>;
}

/** What an entity's list is to its pager. */
export interface PagerList<T> {
  /** What one item is called: "session", in "Next session". */
  noun: string;
  /** Several: "sessions", in "12 sessions match". */
  nouns: string;
  /** The list a filter finds, in the order its table shows it. */
  useWindow: (filter: ListFilter) => ListWindow<T>;
  idOf: (item: T) => string;
  /**
   * Where an item sits in the API's order, for lists read a page at a
   * time: an item not in the list then steps to its real neighbours, and
   * one not read yet is looked for only as far as it could be.
   */
  placeOf?: ((item: T) => Place) | undefined;
}

/** A list the pager can also filter, the way its own page does. */
export interface FilteredPagerList<T> extends PagerList<T> {
  /** Says what is searched: "Search sessions". */
  label: string;
  useFacets: () => ReadonlyArray<Facet>;
  dates?: boolean | undefined;
}
