import { SESSION_PLACES } from "./sessions.constant";
import { REASON_BADGES } from "./session-stage.util";
import type { SearchSessionsRequest, SessionLocation, SessionReason, SessionSearch } from "./sessions.types";
import type { ClientView } from "~/features/clients/clients.types";
import type { Facet, ListFilter } from "~/core/filter/filter.types";
import { clientFacet } from "~/features/clients/clients.util";
import { listRequest } from "~/core/filter/filter.util";
import { oneOf, textParam } from "~/core/utils/search.util";

/** The search a session's page takes: where it was opened from, and for what. */
export function validateSessionSearch(search: Record<string, unknown>): SessionSearch {
  return { from: oneOf(search.from, ["home"] as const), settle: textParam(search.settle) };
}

/** What the sessions list can be narrowed by (SESSION_FACETS). */
export function sessionFacets(clients: ReadonlyArray<ClientView>): Array<Facet> {
  return [
    clientFacet(clients),
    {
      key: "stage",
      label: "Stage",
      options: Object.entries(REASON_BADGES).map(([reason, badge]) => ({ value: reason, label: badge.label })),
    },
    { key: "place", label: "Place", options: Object.entries(SESSION_PLACES).map(([value, label]) => ({ value, label })) },
  ];
}

/** The search the filter asks the API for. */
export function searchSessionsRequest(filter: ListFilter): SearchSessionsRequest {
  return {
    ...listRequest(filter),
    clientIds: [...(filter.chips.client ?? [])],
    locations: [...(filter.chips.place ?? [])] as Array<SessionLocation>,
    todo: [...(filter.chips.stage ?? [])] as Array<SessionReason>,
  };
}
