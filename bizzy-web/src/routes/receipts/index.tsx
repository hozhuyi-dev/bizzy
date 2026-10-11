import { createFileRoute } from "@tanstack/react-router";
import { DocumentsPage } from "~/features/documents/documents-page.component";
import { monthKey } from "~/core/utils/date.util";
import { monthParam } from "~/core/utils/search.util";

export interface ReceiptsSearch {
  month?: string | undefined;
}

export const Route = createFileRoute("/receipts/")({
  validateSearch: (search: Record<string, unknown>): ReceiptsSearch => ({ month: monthParam(search.month) }),
  component: ReceiptsRoute,
});

function ReceiptsRoute() {
  const { month } = Route.useSearch();
  const navigate = Route.useNavigate();
  const thisMonth = monthKey(new Date());

  return (
    <DocumentsPage
      type="receipt"
      month={month ?? thisMonth}
      onMonthChange={(next) => void navigate({ search: { month: next === thisMonth ? undefined : next } })}
    />
  );
}
