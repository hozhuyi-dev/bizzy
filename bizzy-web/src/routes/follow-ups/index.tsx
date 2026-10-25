import { createFileRoute } from "@tanstack/react-router";
import type { FollowUpsSearch } from "~/features/follow-ups/follow-ups.types";
import { FollowUpsPage } from "~/features/follow-ups/follow-ups-page.component";
import { followUpsUrl } from "~/features/follow-ups/follow-ups.util";

export const Route = createFileRoute("/follow-ups/")({
  validateSearch: (search: Record<string, unknown>): FollowUpsSearch => followUpsUrl.validate(search),
  component: FollowUpsRoute,
});

function FollowUpsRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const filter = followUpsUrl.toFilter(search);
  return (
    <FollowUpsPage
      filter={filter}
      onFilterChange={(next) =>
        void navigate({ search: followUpsUrl.toSearch(next), replace: next.text !== filter.text })
      }
    />
  );
}
