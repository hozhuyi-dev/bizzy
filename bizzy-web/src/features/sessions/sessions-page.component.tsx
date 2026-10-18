import { useState } from "react";
import { NEW_SESSION_ACTION } from "./sessions.action";
import { SessionsTable } from "./components/sessions-table/sessions-table.component";
import { SessionsQuery } from "./sessions.query";
import { GoogleNotice } from "~/features/google/components/google-notice/google-notice.component";
import { MonthPicker } from "~/components/shared/month-picker/month-picker.component";
import { PageHeader } from "~/components/shared/page-header/page-header.component";
import { SearchInput } from "~/components/shared/search-input/search-input.component";
import { EmptyState, Loading } from "~/components/shared/quip/quip.component";
import { formatMonth } from "~/core/utils/date.util";
import { queryMatch } from "~/core/utils/query.util";
import { QUIPS } from "~/core/constants/quips.constant";

interface SessionsPageProps {
  /** "2026-10". */
  month: string;
  onMonthChange: (month: string) => void;
}

/** Every session, a month at a time. What needs fixing is on Home. */
export function SessionsPage({ month, onMonthChange }: SessionsPageProps) {
  const [search, setSearch] = useState("");
  const sessions = SessionsQuery.useMonth(month);

  return (
    <>
      <PageHeader
        title="All sessions"
        actions={[NEW_SESSION_ACTION]}
        banners={<GoogleNotice />}
        toolbar={
          <>
            <MonthPicker value={month} onChange={onMonthChange} />
            <SearchInput label="Search sessions" value={search} onChange={setSearch} />
          </>
        }
      />

      {queryMatch(sessions, {
        pending: () => <Loading />,
        error: (error) => (
          <p role="alert" className="text-sm text-destructive">
            {error.message}
          </p>
        ),
        success: (data) => (
          <SessionsTable
            sessions={data}
            query={search}
            empty={
              // Keyed by month: each empty month gets its own line.
              <EmptyState key={month} quips={QUIPS.sessionsHistory}>
                No sessions in {formatMonth(month)}.
              </EmptyState>
            }
          />
        ),
      })}
    </>
  );
}
