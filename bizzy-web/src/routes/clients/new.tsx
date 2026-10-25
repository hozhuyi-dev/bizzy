import { createFileRoute, useLocation } from "@tanstack/react-router";
import { ClientPage } from "~/features/clients/client-page.component";

export const Route = createFileRoute("/clients/new")({
  component: NewClientRoute,
});

/** A new client, named to start with as history says (an unmatched calendar name). */
function NewClientRoute() {
  const name = useLocation({ select: (location) => location.state.name });
  return <ClientPage mode="new" initialName={name} />;
}
