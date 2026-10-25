import { createFileRoute } from "@tanstack/react-router";
import { FollowUpPage } from "~/features/follow-ups/follow-up-page.component";
import { FollowUpsQuery } from "~/features/follow-ups/follow-ups.query";
import { ClientsQuery } from "~/features/clients/clients.query";
import { pageData, prefetch } from "~/core/utils/page-data.util";

export const Route = createFileRoute("/follow-ups/$id")({
  loader: ({ params }) => pageData(prefetch(FollowUpsQuery.detail(params.id)), prefetch(ClientsQuery.list())),
  component: FollowUpRoute,
});

function FollowUpRoute() {
  const { id } = Route.useParams();
  return <FollowUpPage key={id} id={id} />;
}
