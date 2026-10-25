import { createFileRoute } from "@tanstack/react-router";
import type { FollowUpSearch } from "~/features/follow-ups/follow-ups.types";
import { FollowUpPage } from "~/features/follow-ups/follow-up-page.component";
import { FollowUpsQuery } from "~/features/follow-ups/follow-ups.query";
import { followUpsUrl, validateFollowUpSearch } from "~/features/follow-ups/follow-ups.util";
import { ClientsQuery } from "~/features/clients/clients.query";
import { pageData, prefetch } from "~/core/utils/page-data.util";

export const Route = createFileRoute("/follow-ups/$id")({
  // The list it steps through: the follow-ups list's, Home's, a session's or a client's timeline's.
  validateSearch: (search: Record<string, unknown>): FollowUpSearch => validateFollowUpSearch(search),
  loader: ({ params }) => pageData(prefetch(FollowUpsQuery.detail(params.id)), prefetch(ClientsQuery.list())),
  component: FollowUpRoute,
});

function FollowUpRoute() {
  const { id } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <FollowUpPage
      key={id}
      id={id}
      stepping={{
        within: { from: search.from, session: search.session, timeline: search.timeline },
        filter: followUpsUrl.toFilter(search),
        // A new list to step through replaces the entry: Back still returns to the list.
        onFilterChange: (next) => void navigate({ search: followUpsUrl.toSearch(next), replace: true }),
      }}
    />
  );
}
