import { createFileRoute } from "@tanstack/react-router";
import { SharedDocumentPage } from "~/features/documents/shared-document-page.component";

// A document sent to a client: anyone with the link sees it, no sign-in.
export const Route = createFileRoute("/d/$token")({
  staticData: { public: true },
  component: SharedDocumentRoute,
});

function SharedDocumentRoute() {
  const { token } = Route.useParams();
  return <SharedDocumentPage token={token} />;
}
