import type { ReactNode } from "react";
import { SessionsTable } from "~/features/sessions/components/sessions-table/sessions-table.component";
import { SessionsQuery } from "~/features/sessions/sessions.query";
import { GoogleNotice } from "~/features/google/components/google-notice/google-notice.component";
import { SyncButton } from "~/features/sync/sync-button.component";
import { PageHeader } from "~/components/shared/page-header/page-header.component";
import { EmptyState, Loading } from "~/components/shared/quip/quip.component";
import { queryMatch } from "~/core/utils/query.util";
import { QUIPS } from "~/core/constants/quips.constant";

/** Everything that needs her attention, one section per kind of thing. */
export function HomePage() {
  return (
    <>
      <PageHeader title="Home" actions={<SyncButton />} />
      <GoogleNotice />
      <div className="flex flex-col gap-8">
        <SessionsToFix />
      </div>
    </>
  );
}

function SessionsToFix() {
  const open = SessionsQuery.useOpen();
  const count = open.data?.length;

  return (
    <HomeSection title={`Sessions to fix${count ? ` (${count})` : ""}`}>
      {queryMatch(open, {
        pending: () => <Loading />,
        error: (error) => (
          <p role="alert" className="text-sm text-destructive">
            {error.message}
          </p>
        ),
        success: (data) => (
          <SessionsTable
            sessions={data}
            empty={
              <EmptyState quips={QUIPS.sessionsTodo}>
                Sessions that need a client, a fee or a fix show up here.
              </EmptyState>
            }
          />
        ),
      })}
    </HomeSection>
  );
}

function HomeSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}
