import { PlusIcon } from "lucide-react";
import { CANCELLED_STAGE, SESSION_FACETS, SESSION_PLACES } from "./sessions.constant";
import { CANCELLED_BADGE, REASON_BADGES } from "./session-stage.util";
import type { Action } from "~/components/shared/actions/action-bar/action-bar.types";
import type { SearchSessionsRequest, SessionLocation, SessionReason, SessionSearch, SessionView } from "./sessions.types";
import type { ClientView } from "~/features/clients/clients.types";
import type { Facet, ListFilter } from "~/core/list/filter.types";
import type { Place } from "~/core/list/pager.types";
import { clientFacet } from "~/features/clients/clients.util";
import { filterUrl, listRequest } from "~/core/list/filter.util";
import { monthKey } from "~/core/utils/date.util";
import { oneOf, textParam } from "~/core/utils/url-param.util";

/** The sessions list's filter in its URL: this month unless it says otherwise. */
export const sessionsUrl = filterUrl(SESSION_FACETS, () => monthKey(new Date()));

/** The search a session's page takes: the list it steps through, where it was opened from, and for what. */
export function validateSessionSearch(search: Record<string, unknown>): SessionSearch {
  return { ...sessionsUrl.validate(search), from: oneOf(search.from, ["home"] as const), settle: textParam(search.settle) };
}

/** Where a session sits in the sessions list: by its start. */
export function sessionPlace(session: SessionView): Place {
  return { at: Date.parse(session.start), id: session.id };
}

/** What the sessions list can be narrowed by (SESSION_FACETS). */
export function sessionFacets(clients: ReadonlyArray<ClientView>): Array<Facet> {
  return [
    clientFacet(clients),
    {
      key: "stage",
      label: "Stage",
      options: [
        ...Object.entries(REASON_BADGES).map(([reason, badge]) => ({ value: reason, label: badge.label })),
        { value: CANCELLED_STAGE, label: CANCELLED_BADGE.label },
      ],
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
    todo: [...(filter.chips.stage ?? [])].filter((stage) => stage !== CANCELLED_STAGE) as Array<SessionReason>,
    cancelled: (filter.chips.stage ?? []).includes(CANCELLED_STAGE),
  };
}

/** Opens NewSessionDialog, to add a session to the calendar. */
export function newSessionAction(onClick: () => void): Action {
  return {
    type: "button",
    label: "New session",
    icon: PlusIcon,
    style: "primary",
    iconOnlyOnPhone: true,
    onClick,
  };
}
