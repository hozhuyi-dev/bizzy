import { createFileRoute } from "@tanstack/react-router";
import type { SessionReturnTo } from "~/features/sessions/session-page.component";
import { SessionPage } from "~/features/sessions/session-page.component";
import { oneOf } from "~/core/utils/search.util";

export interface SessionSearch {
  /** Where to go back to once saved. */
  from?: SessionReturnTo | undefined;
}

export const validateSessionSearch = (search: Record<string, unknown>): SessionSearch => ({
  from: oneOf(search.from, ["home"] as const),
});

export const Route = createFileRoute("/sessions/new")({
  validateSearch: validateSessionSearch,
  component: NewSessionRoute,
});

function NewSessionRoute() {
  const { from } = Route.useSearch();
  return <SessionPage mode="new" returnTo={from} />;
}
