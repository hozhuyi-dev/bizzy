import { createFileRoute } from "@tanstack/react-router";
import { SessionPage } from "~/features/sessions/session-page.component";
import { validateSessionSearch } from "~/features/sessions/sessions.util";

export const Route = createFileRoute("/sessions/$id")({
  validateSearch: validateSessionSearch,
  component: SessionRoute,
});

function SessionRoute() {
  const { id } = Route.useParams();
  const { from } = Route.useSearch();
  return <SessionPage key={id} mode="edit" eventId={id} returnTo={from} />;
}
