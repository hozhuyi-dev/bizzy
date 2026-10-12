import { createFileRoute } from "@tanstack/react-router";
import { DeletedSessionsPage } from "~/features/sessions/deleted-sessions-page.component";

export const Route = createFileRoute("/sessions/deleted")({
  component: DeletedSessionsPage,
});
