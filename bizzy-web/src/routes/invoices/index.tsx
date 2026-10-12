import { createFileRoute } from "@tanstack/react-router";
import { DocumentsPage } from "~/features/documents/documents-page.component";
import { monthKey } from "~/core/utils/date.util";
import { monthParam } from "~/core/utils/search.util";

export interface InvoicesSearch {
  month?: string | undefined;
}

export const Route = createFileRoute("/invoices/")({
  validateSearch: (search: Record<string, unknown>): InvoicesSearch => ({ month: monthParam(search.month) }),
  component: InvoicesRoute,
});

function InvoicesRoute() {
  const { month } = Route.useSearch();
  const navigate = Route.useNavigate();
  const thisMonth = monthKey(new Date());

  return (
    <DocumentsPage
      type="invoice"
      month={month ?? thisMonth}
      onMonthChange={(next) => void navigate({ search: { month: next === thisMonth ? undefined : next } })}
    />
  );
}
