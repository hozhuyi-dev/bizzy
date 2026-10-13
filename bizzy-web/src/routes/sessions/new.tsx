import { createFileRoute } from "@tanstack/react-router";
import { SessionPage } from "~/features/sessions/session-page.component";
import { validateSessionSearch } from "~/features/sessions/sessions.util";

export const Route = createFileRoute("/sessions/new")({
  validateSearch: validateSessionSearch,
  component: NewSessionRoute,
});

function NewSessionRoute() {
  const { from } = Route.useSearch();
  return <SessionPage mode="new" returnTo={from} />;
}
