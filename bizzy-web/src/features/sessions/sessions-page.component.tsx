import { useMemo, useState } from "react";
import { cn } from "cn";
import { newSessionAction, sessionFacets, sessionPresets, sessionsUrl } from "./sessions.util";
import { SessionsTable } from "./components/sessions-table/sessions-table.component";
import { SessionsQuery } from "./sessions.query";

import type { ListFilter } from "~/core/list/filter.types";
import { ClientsQuery } from "~/features/clients/clients.query";
import { FilterBar } from "~/components/shared/list/filter-bar/filter-bar.component";
import { LoadMore } from "~/components/shared/list/load-more/load-more.component";
import { PageHeader } from "~/components/shared/layout/page-header/page-header.component";
import { EmptyState } from "~/components/shared/feedback/empty-state/empty-state.component";
import { formatWhen, isNarrowed, pageItems } from "~/core/list/filter.util";
import { QUIPS } from "~/core/constants/quips.constant";

interface SessionsPageProps {
  filter: ListFilter;
  onFilterChange: (filter: ListFilter) => void;
}

/**
 * Every session, latest first, searched and narrowed on the server a page
 * at a time: by words in a client's name, the summary or the notes, by
 * client, stage, place, how far its invoice and receipt have got, how it
 * was paid, and days. What needs fixing is on Home.
 */
export function SessionsPage({ filter, onFilterChange }: SessionsPageProps) {
  const clients = ClientsQuery.useList();
  const facets = useMemo(() => sessionFacets(clients.data ?? []), [clients.data]);
  const presets = useMemo(() => sessionPresets(), []);
  const sessions = SessionsQuery.useSearch(filter);
  const rows = useMemo(() => pageItems(sessions.data), [sessions.data]);
  // Each session's page steps through this list.
  const search = useMemo(() => sessionsUrl.toSearch(filter), [filter]);

  return (
    <>
      <PageHeader
        title="Sessions"
        actions={[newSessionAction()]}
        toolbar={
          <FilterBar
            label="Search sessions"
            value={filter}
            onChange={onFilterChange}
            facets={facets}
            presets={presets}
            dates
          />
        }
      />

      <div className={cn("transition-opacity", sessions.isPlaceholderData && "opacity-60")}>
            <SessionsTable
              sessions={rows}
              search={search}
              source={sessions}
              empty={
                isNarrowed(filter) || sessions.hasNextPage ? (
                  <EmptyState quips={QUIPS.search}>No sessions found{sessions.hasNextPage ? " yet" : ""}.</EmptyState>
                ) : (
                  // Keyed by the days: each empty stretch gets its own line.
                  <EmptyState key={filter.when} quips={QUIPS.sessionsHistory}>
                    No sessions{filter.when ? ` in ${formatWhen(filter.when)}` : " yet"}.
                  </EmptyState>
                )
              }
            />
            <LoadMore pages={sessions} found={rows.length > 0} />
      </div>
    </>
  );
}
