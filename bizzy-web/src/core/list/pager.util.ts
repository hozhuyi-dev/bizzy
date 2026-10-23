import type { PagerList, Place, Side, WindowState } from "./pager.types";

/** The item a page shows: its id, and its place once its page has it. */
export interface Current {
  id: string;
  place?: Place | undefined;
  /** It isn't there (deleted, or a stale link): no place will come, so steps go into the list. */
  gone?: boolean | undefined;
}

/** Where the item was last found in the list, to step on from once an edit takes it out. */
export interface Seen {
  ids: ReadonlyArray<string>;
  index: number;
}

/** Where the item is, as far as what is loaded says. */
export type Spot =
  /** Nothing to go by yet. */
  | { kind: "loading" }
  /** In the list, at this index of what is loaded. */
  | { kind: "in"; index: number }
  /** Not in the list; the indexes of the items either side of where it would be. */
  | { kind: "out"; prev: number | undefined; next: number | undefined }
  /** It may be in a page on this side, not read yet. */
  | { kind: "unread"; side: Side };

/** What a step does: go to an index of what is loaded, read a page on a side first, or nothing. */
export type Step = { to: number } | { read: Side } | undefined;

/** Whether a sits above b in a list read latest first. */
export function comesBefore(a: Place, b: Place): boolean {
  return a.at !== b.at ? a.at > b.at : a.id > b.id;
}

/** The index in ids of the closest of seen's ids to its index, going one way, that is still there. */
function nearest(seen: Seen, way: -1 | 1, ids: ReadonlyArray<string>): number | undefined {
  for (let i = seen.index + way; i >= 0 && i < seen.ids.length; i += way) {
    const at = ids.indexOf(seen.ids[i] ?? "");
    if (at >= 0) return at;
  }
  return undefined;
}

/**
 * Where the current item is in a list. Found, it is in. Otherwise, if it
 * was seen in the list before (an edit took it out), it is between the
 * neighbours it had. Otherwise its place says where it would be: between
 * two items loaded, or past an end with more to read there, where it may
 * yet be. A list with no order to place it by has it anywhere below until
 * the end is read; then either way steps into the list. One gone has no
 * place to wait for: a step down enters the list at its top, and a step up
 * at its end once that is read.
 */
export function locate<T>(
  state: WindowState<T>,
  current: Current,
  list: Pick<PagerList<T>, "idOf" | "placeOf">,
  seen?: Seen,
): Spot {
  const { items, hasBefore, hasAfter } = state;
  const ids = items.map(list.idOf);
  const index = ids.indexOf(current.id);
  if (index >= 0) return { kind: "in", index };

  if (seen) {
    const prev = nearest(seen, -1, ids);
    const next = nearest(seen, 1, ids);
    if (prev !== undefined || next !== undefined) return { kind: "out", prev, next };
  }

  if (current.gone) {
    if (items.length === 0) return { kind: "out", prev: undefined, next: undefined };
    return { kind: "out", prev: hasAfter ? undefined : items.length - 1, next: hasBefore ? undefined : 0 };
  }

  const { placeOf } = list;
  if (placeOf) {
    const { place } = current;
    if (!place) return { kind: "loading" };
    const at = items.findIndex((item) => comesBefore(place, placeOf(item)));
    const i = at < 0 ? items.length : at;
    if (i === 0 && hasBefore) return { kind: "unread", side: "before" };
    if (i === items.length && hasAfter) return { kind: "unread", side: "after" };
    return { kind: "out", prev: i > 0 ? i - 1 : undefined, next: i < items.length ? i : undefined };
  }

  if (hasAfter) return { kind: "unread", side: "after" };
  if (items.length === 0) return { kind: "out", prev: undefined, next: undefined };
  return { kind: "out", prev: items.length - 1, next: 0 };
}

/** What a step to one side does from a spot. */
export function stepFrom(spot: Spot, side: Side, state: WindowState<unknown>): Step {
  const more = side === "before" ? state.hasBefore : state.hasAfter;
  switch (spot.kind) {
    case "loading":
      return undefined;
    case "unread":
      return { read: spot.side };
    case "out": {
      const to = side === "before" ? spot.prev : spot.next;
      if (to !== undefined) return { to };
      return more ? { read: side } : undefined;
    }
    case "in": {
      const to = spot.index + (side === "before" ? -1 : 1);
      if (to >= 0 && to < state.items.length) return { to };
      return more ? { read: side } : undefined;
    }
  }
}

/**
 * "3" of "12": the item's number and how many there are. The number is "–"
 * when it isn't in the list, "…" while looking for it, and "?" in a list
 * opened partway; the count has a "+" while there is more to read.
 */
export function positionOf(spot: Spot, state: WindowState<unknown>): { at: string; of: string } | undefined {
  if (spot.kind === "loading") return undefined;
  const of = `${state.items.length}${state.hasBefore || state.hasAfter ? "+" : ""}`;
  switch (spot.kind) {
    case "in":
      return { at: state.hasBefore ? "?" : String(spot.index + 1), of };
    case "out":
      return { at: "–", of };
    case "unread":
      return { at: "…", of };
  }
}
