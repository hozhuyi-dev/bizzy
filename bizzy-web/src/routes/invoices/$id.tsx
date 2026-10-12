import { createFileRoute } from "@tanstack/react-router";
import { DocumentPage } from "~/features/documents/document-page.component";

export const Route = createFileRoute("/invoices/$id")({
  component: InvoiceRoute,
});

function InvoiceRoute() {
  const { id } = Route.useParams();
  return <DocumentPage key={id} id={id} type="invoice" />;
}
