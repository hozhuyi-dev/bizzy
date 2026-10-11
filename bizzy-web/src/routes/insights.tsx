import { createFileRoute } from "@tanstack/react-router";
import { InsightsPage } from "~/features/insights/insights-page.component";
import { oneOf } from "~/core/utils/search.util";

export interface InsightsSearch {
  basis?: "earned" | undefined;
}

export const Route = createFileRoute("/insights")({
  validateSearch: (search: Record<string, unknown>): InsightsSearch => ({
    basis: oneOf(search.basis, ["earned"] as const),
  }),
  component: InsightsRoute,
});

function InsightsRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  return (
    <InsightsPage
      basis={search.basis ?? "received"}
      onBasisChange={(basis) => void navigate({ search: { basis: basis === "received" ? undefined : basis } })}
    />
  );
}
