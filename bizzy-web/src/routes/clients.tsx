import { createFileRoute } from "@tanstack/react-router";
import { ClientsPage } from "~/features/clients/clients-page.component";

export const Route = createFileRoute("/clients")({
  component: ClientsPage,
});
