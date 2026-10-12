import { createFileRoute } from "@tanstack/react-router";
import { ClientsPage, LAPSE_MONTHS } from "~/features/clients/clients-page.component";

export const Route = createFileRoute("/clients/")({
  component: () => <ClientsPage view="all" lapse={LAPSE_MONTHS[0]} />,
});
