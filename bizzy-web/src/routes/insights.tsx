import { createFileRoute } from "@tanstack/react-router";
import { InsightsPage } from "~/features/insights/insights-page.component";

export interface InsightsSearch {
  /** A calendar year before this one; this year when unset. */
  year?: number | undefined;
}

export const Route = createFileRoute("/insights")({
  validateSearch: (search: Record<string, unknown>): InsightsSearch => {
    const year = Number(search.year);
    return { year: Number.isInteger(year) && year >= 2000 && year < new Date().getFullYear() ? year : undefined };
  },
  component: InsightsRoute,
});

function InsightsRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const thisYear = new Date().getFullYear();

  return (
    <InsightsPage
      year={search.year ?? thisYear}
      onYearChange={(year) => void navigate({ search: { year: year === thisYear ? undefined : year } })}
    />
  );
}
