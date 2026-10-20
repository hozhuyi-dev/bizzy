import { createFileRoute } from "@tanstack/react-router";
import type { FilterSearch } from "~/core/filter/filter.types";
import { FollowUpsPage } from "~/features/follow-ups/follow-ups-page.component";
import { FOLLOW_UP_FACETS } from "~/features/follow-ups/follow-ups.constant";
import { filterSearch, toFilter, toSearch } from "~/core/filter/filter.util";
import { textParam } from "~/core/utils/search.util";

export type FollowUpsSearch = FilterSearch<(typeof FOLLOW_UP_FACETS)[number]> & {
  /** The follow-up open to edit: a link to it, and Back closes it. */
  open?: string | undefined;
};

export const Route = createFileRoute("/follow-ups/")({
  validateSearch: (search: Record<string, unknown>): FollowUpsSearch => ({
    ...filterSearch(search, FOLLOW_UP_FACETS),
    open: textParam(search.open),
  }),
  component: UpcomingRoute,
});

function UpcomingRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const filter = toFilter(search, FOLLOW_UP_FACETS);
  return (
    <FollowUpsPage
      view="upcoming"
      filter={filter}
      onFilterChange={(next) =>
        void navigate({ search: { ...toSearch(next, FOLLOW_UP_FACETS), open: search.open }, replace: next.text !== filter.text })
      }
      open={search.open}
      onOpenChange={(id) => void navigate({ search: (prev) => ({ ...prev, open: id }), replace: id === undefined })}
    />
  );
}
