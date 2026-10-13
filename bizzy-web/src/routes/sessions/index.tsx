import { createFileRoute } from "@tanstack/react-router";
import { SessionsPage } from "~/features/sessions/sessions-page.component";
import { monthKey } from "~/core/utils/date.util";
import { monthParam } from "~/core/utils/search.util";

export interface SessionsSearch {
  month?: string | undefined;
}

export const Route = createFileRoute("/sessions/")({
  validateSearch: (search: Record<string, unknown>): SessionsSearch => ({
    month: monthParam(search.month),
  }),
  component: SessionsRoute,
});

function SessionsRoute() {
  const { month } = Route.useSearch();
  const navigate = Route.useNavigate();
  const thisMonth = monthKey(new Date());

  return (
    <SessionsPage
      month={month ?? thisMonth}
      onMonthChange={(next) => void navigate({ search: { month: next === thisMonth ? undefined : next } })}
    />
  );
}
