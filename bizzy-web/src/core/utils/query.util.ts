import type { ReactNode } from "react";

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
