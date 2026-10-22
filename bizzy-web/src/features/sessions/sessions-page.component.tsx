import { useMemo, useState } from "react";
import { cn } from "cn";
import { newSessionAction, sessionFacets, sessionsUrl  } from "./sessions.util";
import { NewSessionDialog } from "./components/booking-dialog/booking-dialog.component";
import { SessionsTable } from "./components/sessions-table/sessions-table.component";
import { SessionsQuery } from "./sessions.query";

import type { ListFilter } from "~/core/list/filter.types";
import { ClientsQuery } from "~/features/clients/clients.query";
import { FilterBar } from "~/components/shared/list/filter-bar/filter-bar.component";
import { LoadMore } from "~/components/shared/list/load-more/load-more.component";
import { PageHeader } from "~/components/shared/layout/page-header/page-header.component";
import { EmptyState } from "~/components/shared/feedback/empty-state/empty-state.component";
import { LoadingState } from "~/components/shared/feedback/loading-state/loading-state.component";
import { formatWhen, isNarrowed, pageItems } from "~/core/list/filter.util";
import { queryMatch } from "~/core/utils/query.util";
import { QUIPS } from "~/core/constants/quips.constant";
import { ErrorMessage } from "~/components/shared/feedback/error-message/error-message.component";

interface SessionsPageProps {
  filter: ListFilter;
  onFilterChange: (filter: ListFilter) => void;
}

/**
 * Every session, latest first, searched and narrowed on the server a page
 * at a time: by words in a client's name, the summary or the notes, by
 * client, stage, place and days. What needs fixing is on Home.
 */
export function SessionsPage({ filter, onFilterChange }: SessionsPageProps) {
  const clients = ClientsQuery.useList();
  const facets = useMemo(() => sessionFacets(clients.data ?? []), [clients.data]);
  const sessions = SessionsQuery.useSearch(filter);
  const rows = useMemo(() => pageItems(sessions.data), [sessions.data]);
  // Each session's page steps through this list.
  const search = useMemo(() => sessionsUrl.toSearch(filter), [filter]);
  const [adding, setAdding] = useState(false);

  return (
    <>
      <NewSessionDialog open={adding} onClose={() => setAdding(false)} />
      <PageHeader
        title="All sessions"
        actions={[newSessionAction(() => setAdding(true))]}
        toolbar={<FilterBar label="Search sessions" value={filter} onChange={onFilterChange} facets={facets} dates />}
      />

      {queryMatch(sessions, {
        pending: () => <LoadingState />,
        error: (error) => (
          <ErrorMessage>{error.message}</ErrorMessage>
        ),
        success: () => (
          <div className={cn("transition-opacity", sessions.isPlaceholderData && "opacity-60")}>
            <SessionsTable
              sessions={rows}
              search={search}
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
        ),
      })}
    </>
  );
}
