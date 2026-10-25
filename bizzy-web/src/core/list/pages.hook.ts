import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import type { QueryKey } from "@tanstack/react-query";
import type { Page } from "./filter.types";

/**
 * A list read a page at a time: each page from the last one's next. The
 * pages shown stay while another filter's load, so the list doesn't blank
 * out as she types (isPlaceholderData says they are the old ones).
 */
export function usePages<TPage extends Page<unknown>>(
  queryKey: QueryKey,
  fetchPage: (after: string | undefined) => Promise<TPage>,
  enabled = true,
) {
  return useInfiniteQuery({
    queryKey,
    enabled,
    queryFn: ({ pageParam }) => fetchPage(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next,
    placeholderData: keepPreviousData,
  });
}
