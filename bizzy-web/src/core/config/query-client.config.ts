import { QueryClient } from "@tanstack/react-query";
import { ApiError, onChanged } from "~/core/lambda/lambda.client";
import { holdingChanges } from "~/core/utils/query.util";

/**
 * How long what is cached counts as fresh: what the clock changes (a
 * session past its start) is read again after it, on showing it again or
 * coming back to the app (see useStayCurrent).
 */
export const FRESH_MS = 5 * 60_000;

/**
 * The app's one query cache. Every call says what it changed, and each
 * kind's version, so what it or another device changed is read again (see
 * refreshChanged and invoke); what is cached stays true, and isn't read
 * again on focus. Coming back to the app asks what changed meanwhile (or
 * syncs, when the calendar may have changed): one call, see
 * useStayCurrent.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: FRESH_MS,
      refetchOnWindowFocus: false,
      // A read is tried again only when it may work a moment later: what
      // the API answered (gone, invalid) shows at once.
      retry: (failures, error) => failures < 2 && mayPassLater(error),
    },
  },
});

/** An error that trying again shortly may clear: the API out of reach, busy, crashed or migrating. */
export function mayPassLater(error: unknown): boolean {
  return !(error instanceof ApiError) || ["unreachable", "busy", "internal", "unavailable", "conflict"].includes(error.code);
}

/** What calls change, read again now, or once a held run of calls ends (see holdingChanges). */
export const changes = holdingChanges(queryClient);

onChanged((changed, keep, action) => changes.changed(changed, keep, action));
