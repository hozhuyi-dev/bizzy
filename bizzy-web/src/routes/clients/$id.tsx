import { createFileRoute } from "@tanstack/react-router";
import { ClientPage } from "~/features/clients/client-page.component";

export const Route = createFileRoute("/clients/$id")({
  component: ClientRoute,
});

function ClientRoute() {
  const { id } = Route.useParams();
  return <ClientPage key={id} mode="edit" id={id} />;
}
