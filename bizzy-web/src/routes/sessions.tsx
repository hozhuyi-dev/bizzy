import { createFileRoute } from "@tanstack/react-router";
import { SessionsPage } from "~/features/sessions/sessions-page.component";
import { monthKey } from "~/core/utils/date.util";
import { monthParam } from "~/core/utils/search.util";

export interface SessionsSearch {
  month?: string | undefined;
}

export const Route = createFileRoute("/sessions")({
  validateSearch: (search: Record<string, unknown>): SessionsSearch => ({
    month: monthParam(search.month),
  }),
  component: SessionsRoute,
});

function SessionsRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  return (
    <SessionsPage
      month={search.month ?? monthKey(new Date())}
      onMonthChange={(month) => void navigate({ search: (prev) => ({ ...prev, month }) })}
    />
  );
}
