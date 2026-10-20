import { Button } from "~/components/ui/button";

interface LoadMoreProps {
  /** The paged query of the list above (see usePages). */
  pages: { hasNextPage: boolean; isFetchingNextPage: boolean; fetchNextPage: () => unknown };
  /** Whether the list shows anything yet: with nothing, it looks further back. */
  found: boolean;
}

/**
 * Under a list read a page at a time: the next page, while there is one. A
 * page that found nothing may only mean the search looked at enough for
 * now, so it offers to look further back.
 */
export function LoadMore({ pages, found }: LoadMoreProps) {
  if (!pages.hasNextPage) return null;
  return (
    <div className="flex justify-center py-3">
      <Button variant="outline" size="sm" disabled={pages.isFetchingNextPage} onClick={() => void pages.fetchNextPage()}>
        {pages.isFetchingNextPage ? "Looking…" : found ? "Show more" : "Look further back"}
      </Button>
    </div>
  );
}
