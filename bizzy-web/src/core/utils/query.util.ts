import type { ReactNode } from "react";
import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { BILLING_KEYS } from "~/core/constants/query-keys.constant";

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

/**
 * Refreshes everything a billing change can touch; see BILLING_KEYS.
 * `except` skips one query, e.g. a document that was just deleted.
 */
export function invalidateBilling(queryClient: QueryClient, except?: QueryKey): Promise<unknown> {
  const skipped = except && JSON.stringify(except);
  return Promise.all(
    BILLING_KEYS.map((queryKey) =>
      queryClient.invalidateQueries({
        queryKey,
        predicate: (query) => JSON.stringify(query.queryKey) !== skipped,
      }),
    ),
  );
}
