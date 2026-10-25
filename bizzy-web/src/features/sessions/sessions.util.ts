import { PlusIcon } from "lucide-react";
import { CANCELLED_STAGE, SESSION_FACETS, SESSION_PLACES } from "./sessions.constant";
import { CANCELLED_BADGE, REASON_BADGES } from "./session-stage.util";
import type { Action } from "~/components/shared/actions/action-bar/action-bar.types";
import type { SearchSessionsRequest, SessionLocation, SessionReason, SessionReturnTo, SessionSearch, SessionView } from "./sessions.types";
import type { ClientView } from "~/features/clients/clients.types";
import type { Facet, FilterPreset, ListFilter } from "~/core/list/filter.types";
import type { Paperwork } from "~/features/documents/documents.util";
import type { Place } from "~/core/list/pager.types";
import { clientFacet } from "~/features/clients/clients.util";
import { paperworkFacet } from "~/features/documents/documents.util";
import { PAYMENT_FACET } from "~/features/payments/payments.util";
import { NO_FILTER, filterUrl, listRequest } from "~/core/list/filter.util";
import { monthKey } from "~/core/utils/date.util";
import { oneOf, textParam } from "~/core/utils/url-param.util";

/** The sessions list's filter in its URL: this month unless it says otherwise. */
export const sessionsUrl = filterUrl(SESSION_FACETS, () => monthKey(new Date()));

/** The search a session's page takes: the list it steps through, and where it was opened from. */
export function validateSessionSearch(search: Record<string, unknown>): SessionSearch {
  return {
    ...sessionsUrl.validate(search),
    from: oneOf(search.from, ["home", "today"] as const),
    timeline: textParam(search.timeline),
  };
}

/** A client's sessions, at any time: what a session opened from their page steps through. */
export function clientSessionsSearch(clientId: string): SessionSearch {
  return sessionsUrl.toSearch({ ...NO_FILTER, chips: { client: [clientId] } });
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
    paperworkFacet("invoice"),
    paperworkFacet("receipt"),
    PAYMENT_FACET,
  ];
}

/** The ways the sessions list is usually looked at: this month first, as it opens; then what is left to do, at any time. */
export function sessionPresets(now = new Date()): Array<FilterPreset> {
  return [
    { label: "This month", when: monthKey(now), chips: {} },
    { label: "To confirm", when: undefined, chips: { stage: ["confirm"] } },
    { label: "To record", when: undefined, chips: { stage: ["record"] } },
    { label: "Unpaid", when: undefined, chips: { stage: ["collect"] } },
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
    invoices: [...(filter.chips.invoice ?? [])] as Array<Paperwork>,
    receipts: [...(filter.chips.receipt ?? [])] as Array<Paperwork>,
    payments: [...(filter.chips.payment ?? [])],
  };
}

/** Opens a new session's page, to add one to the calendar; `from` Home, its page goes back there once it has one. */
export function newSessionAction(from?: SessionReturnTo): Action {
  return {
    type: "link",
    label: "New session",
    icon: PlusIcon,
    style: "primary",
    iconOnlyOnPhone: true,
    link: { to: "/sessions/new", state: { from } },
  };
}
