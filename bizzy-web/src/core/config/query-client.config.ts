import { QueryClient } from "@tanstack/react-query";
import { onChanged } from "~/core/lambda/lambda.client";
import { holdingChanges } from "~/core/utils/query.util";

/**
 * The app's one query cache. Every call says what it changed, and only
 * what shows that is read again (see refreshChanged), so what is cached
 * stays true: it counts as fresh for minutes, and isn't read again on
 * mount or focus. What changes outside the app (the calendar) comes in by
 * syncing, which says what it changed too.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60_000,
      refetchOnWindowFocus: false,
    },
  },
});

/** What calls change, read again now, or once a held run of calls ends (see holdingChanges). */
export const changes = holdingChanges(queryClient);

onChanged((changed, keep) => changes.changed(changed, keep));
