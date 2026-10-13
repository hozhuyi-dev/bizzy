import { createFileRoute } from "@tanstack/react-router";
import { ClientsPage } from "~/features/clients/clients-page.component";
import { LAPSE_MONTHS } from "~/features/clients/clients.constant";

export const Route = createFileRoute("/clients/")({
  component: () => <ClientsPage view="all" lapse={LAPSE_MONTHS[0]} />,
});
