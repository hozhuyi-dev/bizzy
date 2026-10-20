import { createFileRoute } from "@tanstack/react-router";
import type { FilterSearch } from "~/core/filter/filter.types";
import { SessionsPage } from "~/features/sessions/sessions-page.component";
import { SESSION_FACETS } from "~/features/sessions/sessions.constant";
import { filterSearch, toFilter, toSearch } from "~/core/filter/filter.util";
import { monthKey } from "~/core/utils/date.util";

export type SessionsSearch = FilterSearch<(typeof SESSION_FACETS)[number]>;

export const Route = createFileRoute("/sessions/")({
  validateSearch: (search: Record<string, unknown>): SessionsSearch => filterSearch(search, SESSION_FACETS),
  component: SessionsRoute,
});

function SessionsRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  // This month unless the URL says otherwise.
  const thisMonth = monthKey(new Date());
  const filter = toFilter(search, SESSION_FACETS, thisMonth);

  return (
    <SessionsPage
      filter={filter}
      onFilterChange={(next) =>
        // Typing replaces the entry; a chip is a step back can undo.
        void navigate({ search: toSearch(next, SESSION_FACETS, thisMonth), replace: next.text !== filter.text })
      }
    />
  );
}
