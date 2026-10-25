import { createFileRoute } from "@tanstack/react-router";
import { NewSessionPage } from "~/features/sessions/new-session-page.component";
import { ClientsQuery } from "~/features/clients/clients.query";
import { PackagesQuery } from "~/features/packages/packages.query";
import { pageData, prefetch } from "~/core/utils/page-data.util";

export const Route = createFileRoute("/sessions/new")({
  loader: () => pageData(prefetch(ClientsQuery.list()), prefetch(PackagesQuery.list(true))),
  component: () => <NewSessionPage />,
});
