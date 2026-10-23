import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { locate, positionOf, stepFrom } from "./pager.util";
import { pageItems } from "./filter.util";
import type { InfiniteData, UseInfiniteQueryResult } from "@tanstack/react-query";
import type { LinkOptions } from "@tanstack/react-router";
import type { Current, Seen, Spot } from "./pager.util";
import type { ListWindow, PagerList, Side, WindowState } from "./pager.types";
import type { Page } from "./filter.types";

/**
 * How many pages the pager reads by itself to find an item opened from
 * elsewhere (a bookmark); a step reads on as far as it takes.
 */
const AUTO_READS = 3;

/** A list read a page at a time from the top (usePages) as a window. */
export function usePagesWindow<T>(pages: UseInfiniteQueryResult<InfiniteData<Page<T>>>): ListWindow<T> {
  const items = useMemo(() => pageItems(pages.data), [pages.data]);
  const { fetchNextPage } = pages;
  return {
    items,
    hasBefore: false,
    hasAfter: pages.hasNextPage,
    // Another filter's pages, kept while its own load, say nothing of this one.
    pending: pages.isPending || pages.isPlaceholderData,
    loading: pages.isFetchingNextPage,
    load: async (side) => {
      if (side === "before") return { items, hasBefore: false, hasAfter: pages.hasNextPage };
      const next = await fetchNextPage();
      if (next.isError) throw next.error;
      return { items: pageItems(next.data), hasBefore: false, hasAfter: next.hasNextPage };
    },
  };
}

/** A list loaded all at once as a window. */
export function useAllWindow<T>(items: ReadonlyArray<T> | undefined): ListWindow<T> {
  return useMemo(() => {
    const state: WindowState<T> = { items: items ?? [], hasBefore: false, hasAfter: false };
    return { ...state, pending: items === undefined, loading: false, load: () => Promise.resolve(state) };
  }, [items]);
}

export interface PagerOptions<T> {
  list: PagerList<T>;
  window: ListWindow<T>;
  current: Current;
  /** Changes with the filter: where it was seen, and the reads to find it, start again. */
  filterKey: string;
  /** An item's page, keeping the list it is stepped through. */
  itemLink: (id: string) => LinkOptions;
}

export interface Pager {
  spot: Spot;
  position: { at: string; of: string } | undefined;
  canStep: Record<Side, boolean>;
  /**
   * The way a step is going, until its page opens: reading the list on to
   * find the next item, then the next page's data (see pageData), while
   * this page stays on screen.
   */
  stepping: Side | undefined;
  step: (side: Side) => void;
}

/**
 * Steps an entity's page through a list: where the item is in it, and the
 * item above or below. Each step replaces the page in the history, so Back
 * returns to the list. A step goes through the unsaved-changes prompt
 * like any other link.
 */
export function usePager<T>({ list, window, current, filterKey, itemLink }: PagerOptions<T>): Pager {
  const router = useRouter();
  const [stepping, setStepping] = useState<Side | undefined>(undefined);

  // Where it was last found, for this filter: an edit that takes it out
  // (a session paid, off an Unpaid list) still steps on from there.
  const ids = useMemo(() => window.items.map(list.idOf), [window.items, list.idOf]);
  const [seen, setSeen] = useState<(Seen & { key: string }) | undefined>(undefined);
  const found = window.pending ? -1 : ids.indexOf(current.id);
  if (found >= 0 && (!seen || !sameIds(seen.ids, ids) || seen.index !== found || seen.key !== filterKey)) {
    setSeen({ ids, index: found, key: filterKey });
  }
  const seenHere = seen?.key === filterKey ? seen : undefined;

  const spot: Spot = window.pending ? { kind: "loading" } : locate(window, current, list, seenHere);

  // An item opened from elsewhere may be in a page not read yet: read a
  // few, as far as it could be.
  const reads = useRef({ key: filterKey, count: 0, busy: false });
  const unreadSide = spot.kind === "unread" ? spot.side : undefined;
  const readAhead = useEffectEvent((side: Side) => {
    if (reads.current.key !== filterKey) reads.current = { key: filterKey, count: 0, busy: false };
    const r = reads.current;
    if (r.busy || window.loading || stepping || r.count >= AUTO_READS) return;
    r.count++;
    r.busy = true;
    // A page that fails shows on the list's own page; here it just stops looking.
    window
      .load(side)
      .catch(() => undefined)
      .finally(() => (r.busy = false));
  });
  useEffect(() => {
    if (unreadSide) readAhead(unreadSide);
  }, [unreadSide, window.items]);

  const step = async (side: Side) => {
    if (stepping) return;
    let state: WindowState<T> = window;
    let move = stepFrom(spot, side, state);
    if (!move) return;
    setStepping(side);
    try {
      // Reads on until the step can go; each read either finds it or moves the end on.
      while (move && "read" in move) {
        state = await window.load(move.read);
        move = stepFrom(locate(state, current, list, seenHere), side, state);
      }
      const target = move ? state.items[move.to] : undefined;
      // Resolves once the next page is ready to show, or the step was blocked.
      if (target !== undefined) await router.navigate({ ...itemLink(list.idOf(target)), replace: true });
    } catch {
      // A page that fails shows on the list's own page; the step just doesn't go.
    } finally {
      setStepping(undefined);
    }
  };

  return {
    spot,
    position: positionOf(spot, window),
    canStep: { before: stepFrom(spot, "before", window) !== undefined, after: stepFrom(spot, "after", window) !== undefined },
    stepping,
    step: (side) => void step(side),
  };
}

function sameIds(a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean {
  return a === b || (a.length === b.length && a.every((id, i) => id === b[i]));
}

/** Whether a key press belongs to something being typed in, or to an open dialog. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/** J steps down the list and K up, as in Gmail, unless she is typing or a dialog is open. */
export function useStepKeys(step: (side: Side) => void) {
  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (isTyping(event.target) || document.querySelector("[role='dialog'], [role='alertdialog']")) return;
    const key = event.key.toLowerCase();
    if (key !== "j" && key !== "k") return;
    event.preventDefault();
    step(key === "j" ? "after" : "before");
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKey(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
}
