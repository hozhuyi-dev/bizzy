import { createFileRoute } from "@tanstack/react-router";
import type { SessionsSearch } from "~/features/sessions/sessions.types";
import { SessionsPage } from "~/features/sessions/sessions-page.component";
import { sessionsUrl } from "~/features/sessions/sessions.util";

export const Route = createFileRoute("/sessions/")({
  validateSearch: (search: Record<string, unknown>): SessionsSearch => sessionsUrl.validate(search),
  component: SessionsRoute,
});

function SessionsRoute() {
  const navigate = Route.useNavigate();
  // This month unless the URL says otherwise.
  const filter = sessionsUrl.toFilter(Route.useSearch());

  return (
    <SessionsPage
      filter={filter}
      onFilterChange={(next) =>
        // Typing replaces the entry; a chip is a step back can undo.
        void navigate({ search: sessionsUrl.toSearch(next), replace: next.text !== filter.text })
      }
    />
  );
}
