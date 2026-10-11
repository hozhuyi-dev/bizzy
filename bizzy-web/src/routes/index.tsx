import { createFileRoute } from "@tanstack/react-router";
import { SessionsPage } from "~/features/sessions/sessions-page.component";
import { monthKey } from "~/core/utils/date.util";
import { monthParam, oneOf } from "~/core/utils/search.util";

export interface SessionsSearch {
  view?: "history" | undefined;
  month?: string | undefined;
}

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): SessionsSearch => ({
    view: oneOf(search.view, ["history"] as const),
    month: monthParam(search.month),
  }),
  component: SessionsRoute,
});

function SessionsRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  return (
    <SessionsPage
      view={search.view ?? "todo"}
      month={search.month ?? monthKey(new Date())}
      onViewChange={(view) =>
        void navigate({ search: (prev) => ({ ...prev, view: view === "todo" ? undefined : view }) })
      }
      onMonthChange={(month) => void navigate({ search: (prev) => ({ ...prev, month }) })}
    />
  );
}
