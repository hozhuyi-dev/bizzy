import { Button } from "~/components/ui/button";

interface LoadMoreProps {
  hasMore: boolean;
  loading: boolean;
  onLoad: () => void;
}

/**
 * The end of a list read a page at a time. DynamoDB can't count cheaply, so
 * lists say "load more" rather than show page numbers.
 */
export function LoadMore({ hasMore, loading, onLoad }: LoadMoreProps) {
  if (!hasMore) return null;
  return (
    <div className="flex justify-center pt-2">
      <Button variant="outline" size="sm" disabled={loading} onClick={onLoad}>
        {loading ? "Loading…" : "Load more"}
      </Button>
    </div>
  );
}
