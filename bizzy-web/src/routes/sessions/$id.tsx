import { createFileRoute } from "@tanstack/react-router";
import { SessionPage } from "~/features/sessions/session-page.component";
import { sessionsUrl, validateSessionSearch } from "~/features/sessions/sessions.util";

export const Route = createFileRoute("/sessions/$id")({
  validateSearch: validateSessionSearch,
  component: SessionRoute,
});

function SessionRoute() {
  const { id } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <SessionPage
      key={id}
      id={id}
      returnTo={search.from}
      settle={search.settle}
      filter={sessionsUrl.toFilter(search)}
      // A new list to step through replaces the entry: Back still returns to the list.
      onFilterChange={(next) =>
        void navigate({ search: (prev) => ({ ...prev, ...sessionsUrl.toSearch(next) }), replace: true })
      }
    />
  );
}
