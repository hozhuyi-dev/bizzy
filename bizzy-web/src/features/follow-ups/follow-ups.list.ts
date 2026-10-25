import { useMemo } from "react";
import { FollowUpsQuery } from "./follow-ups.query";
import { FOLLOW_UP_ORIGIN_FACET, FOLLOW_UP_STATUS_FACET } from "./follow-ups.constant";
import type { FollowUpView } from "./follow-ups.types";
import type { FilteredPagerList } from "~/core/list/pager.types";
import { ClientsQuery } from "~/features/clients/clients.query";
import { clientFacet } from "~/features/clients/clients.util";
import { usePagesWindow } from "~/core/list/pager.hook";

/**
 * The follow-ups list, for a follow-up's page to step through. It has no
 * one order to place an item by (the open soonest first, the rest latest
 * first), so one not in it is looked for a few pages down.
 */
export const FOLLOW_UPS_LIST: FilteredPagerList<FollowUpView> = {
  noun: "follow-up",
  nouns: "follow-ups",
  label: "Search follow-ups",
  dates: true,
  useWindow: (filter) => usePagesWindow(FollowUpsQuery.useSearch(filter)),
  useFacets: () => {
    const clients = ClientsQuery.useList();
    return useMemo(() => [FOLLOW_UP_STATUS_FACET, clientFacet(clients.data ?? []), FOLLOW_UP_ORIGIN_FACET], [clients.data]);
  },
  idOf: (followUp) => followUp.id,
};
