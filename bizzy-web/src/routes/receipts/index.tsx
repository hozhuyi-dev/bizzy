import { createFileRoute } from "@tanstack/react-router";
import { DocumentsPage } from "~/features/documents/documents-page.component";

export const Route = createFileRoute("/receipts/")({
  component: () => <DocumentsPage type="receipt" />,
});
