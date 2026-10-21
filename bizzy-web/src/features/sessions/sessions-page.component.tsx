import { useMemo, useState } from "react";
import { cn } from "cn";
import { newSessionAction } from "./sessions.action";
import { NewSessionDialog } from "./components/booking-dialog/booking-dialog.component";
import { SessionsTable } from "./components/sessions-table/sessions-table.component";
import { SessionsQuery } from "./sessions.query";
import { sessionFacets, sessionsUrl } from "./sessions.util";
import type { ListFilter } from "~/core/list/filter.types";
import { ClientsQuery } from "~/features/clients/clients.query";
import { GoogleNotice } from "~/features/google/components/google-notice/google-notice.component";
import { FilterBar } from "~/components/shared/filter-bar/filter-bar.component";
import { LoadMore } from "~/components/shared/load-more/load-more.component";
import { PageHeader } from "~/components/shared/page-header/page-header.component";
import { EmptyState, Loading } from "~/components/shared/quip/quip.component";
import { formatWhen, isNarrowed, pageItems } from "~/core/list/filter.util";
import { queryMatch } from "~/core/utils/query.util";
import { QUIPS } from "~/core/constants/quips.constant";

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
        banners={<GoogleNotice />}
        toolbar={<FilterBar label="Search sessions" value={filter} onChange={onFilterChange} facets={facets} dates />}
      />

      {queryMatch(sessions, {
        pending: () => <Loading />,
        error: (error) => (
          <p role="alert" className="text-sm text-destructive">
            {error.message}
          </p>
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
