import { createFileRoute } from "@tanstack/react-router";
import { DocumentPage } from "~/features/documents/document-page.component";

export const Route = createFileRoute("/receipts/$id")({
  component: ReceiptRoute,
});

function ReceiptRoute() {
  const { id } = Route.useParams();
  return <DocumentPage key={id} id={id} type="receipt" />;
}
