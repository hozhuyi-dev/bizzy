import { createFileRoute } from "@tanstack/react-router";
import type { GoogleCallbackSearch } from "~/features/google/google.types";
import { GoogleCallbackPage } from "~/features/google/google-callback-page.component";
import { textParam } from "~/core/utils/search.util";

export const Route = createFileRoute("/google-callback")({
  validateSearch: (search: Record<string, unknown>): GoogleCallbackSearch => ({
    code: textParam(search.code),
    state: textParam(search.state),
    error: textParam(search.error),
  }),
  component: GoogleCallbackRoute,
});

function GoogleCallbackRoute() {
  return <GoogleCallbackPage {...Route.useSearch()} />;
}
