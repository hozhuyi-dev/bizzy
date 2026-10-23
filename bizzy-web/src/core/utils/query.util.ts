import type { ReactNode } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { AuthKeys, CHANGED_KEYS } from "~/core/constants/query-keys.constant";

/**
 * What a part of a page waits on before it shows: its query, or the
 * several it reads together (see allOf).
 */
export interface Loadable {
  isPending: boolean;
  error: Error | null;
  /** Shows another read's data (the filter before) while its own comes. */
  isPlaceholderData?: boolean | undefined;
  /** Reads again what failed. */
  refetch: () => unknown;
}

/**
 * Several queries as one, for a part that shows what they say together
 * (sessions with their clients' names): pending until every one has data,
 * so nothing fills in after it shows; failed once any has, and trying
 * again reads again only what failed.
 */
export function allOf(...queries: ReadonlyArray<Loadable>): Loadable {
  const failed = queries.filter((query) => query.error);
  return {
    isPending: failed.length === 0 && queries.some((query) => query.isPending),
    error: failed[0]?.error ?? null,
    isPlaceholderData: queries.some((query) => query.isPlaceholderData === true),
    refetch: () => Promise.all(failed.map((query) => query.refetch())),
  };
}

interface QueryState<TData, TError extends Error = Error> {
  isPending: boolean;
  error: TError | null;
  data: TData | undefined;
}

interface QueryMatchCases<TData, TError extends Error = Error> {
  pending: () => ReactNode;
  error: (error: TError) => ReactNode;
  success: (data: TData) => ReactNode;
}

export function queryMatch<TData, TError extends Error = Error>(
  state: QueryState<TData, TError>,
  cases: QueryMatchCases<TData, TError>
): ReactNode {
  if (state.isPending) return cases.pending();
  if (state.error) return cases.error(state.error);
  return cases.success(state.data as TData);
}

type Keys = ReadonlyArray<ReadonlyArray<unknown>>;

/** Whether a query is one of `keep`. */
const kept = (queryKey: ReadonlyArray<unknown>, keep: Keys) =>
  keep.some((key) => JSON.stringify(key) === JSON.stringify(queryKey));

/**
 * Reads again what shows the kinds of item a call changed (CHANGED_KEYS),
 * but `keep` (see keeping): the queries on screen now, the others when
 * next shown.
 */
export function refreshChanged(queryClient: QueryClient, changed: ReadonlyArray<string>, keep: Keys = []): Promise<unknown> {
  if (changed.some((kind) => !(kind in CHANGED_KEYS))) return refreshAll(queryClient, keep);
  const roots = new Map(changed.flatMap((kind) => CHANGED_KEYS[kind] ?? []).map((key) => [JSON.stringify(key), key]));
  return Promise.all(
    [...roots.values()].map((queryKey) =>
      queryClient.invalidateQueries({ queryKey, predicate: (query) => !kept(query.queryKey, keep) }),
    ),
  );
}

/** Reads everything again but who is signed in (and `keep`): after an edit the API found stale. */
export function refreshAll(queryClient: QueryClient, keep: Keys = []): Promise<unknown> {
  return queryClient.invalidateQueries({
    predicate: (query) => query.queryKey[0] !== AuthKeys.all[0] && !kept(query.queryKey, keep),
  });
}

/**
 * Holds what calls change until `released`, then reads it again once: for
 * a run of calls (the backfill) whose pages would otherwise be read again
 * after each.
 */
export function holdingChanges(queryClient: QueryClient) {
  let held: Set<string> | undefined;
  return {
    /** Refreshes now, or later while held. */
    changed(changed: ReadonlyArray<string>, keep: Keys = []): void {
      if (held) changed.forEach((kind) => held?.add(kind));
      else void refreshChanged(queryClient, changed, keep);
    },
    hold(): () => void {
      held ??= new Set();
      return () => {
        const kinds = held;
        held = undefined;
        if (kinds?.size) void refreshChanged(queryClient, [...kinds]);
      };
    },
  };
}
