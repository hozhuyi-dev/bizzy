import { PendingButton } from "~/components/shared/actions/pending-button/pending-button.component";

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
      <PendingButton variant="outline" size="sm" pending={pages.isFetchingNextPage} onClick={() => void pages.fetchNextPage()}>
        {found ? "Show more" : "Look further back"}
      </PendingButton>
    </div>
  );
}
