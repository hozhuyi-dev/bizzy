import { createFileRoute } from "@tanstack/react-router";
import type { FilterSearch } from "~/core/filter/filter.types";
import { FollowUpsPage } from "~/features/follow-ups/follow-ups-page.component";
import { FOLLOW_UP_FACETS } from "~/features/follow-ups/follow-ups.constant";
import { filterSearch, toFilter, toSearch } from "~/core/filter/filter.util";

export type DoneFollowUpsSearch = FilterSearch<(typeof FOLLOW_UP_FACETS)[number]>;

export const Route = createFileRoute("/follow-ups/done")({
  validateSearch: (search: Record<string, unknown>): DoneFollowUpsSearch => filterSearch(search, FOLLOW_UP_FACETS),
  component: DoneRoute,
});

function DoneRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const filter = toFilter(search, FOLLOW_UP_FACETS);
  return (
    <FollowUpsPage
      view="done"
      filter={filter}
      onFilterChange={(next) =>
        void navigate({ search: toSearch(next, FOLLOW_UP_FACETS), replace: next.text !== filter.text })
      }
    />
  );
}
