import { Link } from "@tanstack/react-router";
import { EmptyState } from "~/components/shared/feedback/empty-state/empty-state.component";
import { Button } from "~/components/ui/button";
import { QUIPS } from "~/core/constants/quips.constant";

/** An unknown address: a quip and the way back. */
export function NotFoundPage() {
  return (
    <div className="flex flex-col items-center gap-4 py-16">
      <EmptyState quips={QUIPS.notFound}>Page not found.</EmptyState>
      <Button variant="outline" render={<Link to="/" />} nativeButton={false}>
        Back to sessions
      </Button>
    </div>
  );
}
