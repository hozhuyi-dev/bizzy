import { createFileRoute } from "@tanstack/react-router";
import { FollowUpPage } from "~/features/follow-ups/follow-up-page.component";
import { ClientsQuery } from "~/features/clients/clients.query";
import { pageData, prefetch } from "~/core/utils/page-data.util";

export const Route = createFileRoute("/follow-ups/new")({
  loader: () => pageData(prefetch(ClientsQuery.list())),
  component: () => <FollowUpPage />,
});
