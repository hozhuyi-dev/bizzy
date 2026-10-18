import { createFileRoute } from "@tanstack/react-router";
import { FollowUpsPage } from "~/features/follow-ups/follow-ups-page.component";
import { textParam } from "~/core/utils/search.util";

export interface FollowUpsSearch {
  /** The follow-up open to edit: a link to it, and Back closes it. */
  open?: string | undefined;
}

export const Route = createFileRoute("/follow-ups/")({
  validateSearch: (search: Record<string, unknown>): FollowUpsSearch => ({ open: textParam(search.open) }),
  component: UpcomingRoute,
});

function UpcomingRoute() {
  const { open } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <FollowUpsPage
      view="upcoming"
      open={open}
      onOpenChange={(id) => void navigate({ search: { open: id }, replace: id === undefined })}
    />
  );
}
