import type { FetchQueryOptions, QueryKey } from "@tanstack/react-query";
import { queryClient } from "~/core/config/query-client.config";

let shown = false;

/** Told once the router has shown its first page (see getRouter). */
export function pageShown(): void {
  shown = true;
}

/** Reads a query into the cache, unless it is there and fresh; never throws (the page shows the error). */
export function prefetch<T, TKey extends QueryKey>(options: FetchQueryOptions<T, Error, T, TKey>): Promise<void> {
  return queryClient.prefetchQuery(options);
}

/**
 * A route's loader: reads what its page shows before the page opens, so
 * the page being left stays on screen meanwhile (the bar under the nav, or
 * a pager's button, says it is coming) and the next one opens whole,
 * rather than on its loading state. A read that fails opens the page on
 * its error. A hover reads ahead the same way (defaultPreload). On the
 * app's first load there is no page to keep, so it opens at once, on its
 * own loading state.
 */
export function pageData(...reads: ReadonlyArray<Promise<void>>): Promise<void> | undefined {
  const all = Promise.all(reads).then(() => undefined);
  return shown ? all : undefined;
}
