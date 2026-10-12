import { useState } from "react";
import { PlusIcon } from "lucide-react";
import { FollowUpDialog } from "./components/follow-up-dialog/follow-up-dialog.component";
import { FollowUpRow } from "./components/follow-up-row/follow-up-row.component";
import { FollowUpsQuery } from "./follow-ups.query";
import type { FollowUpTarget } from "./components/follow-up-dialog/follow-up-dialog.component";
import type { FollowUpView } from "./follow-ups.types";
import { GoogleNotice } from "~/features/google/components/google-notice/google-notice.component";
import { LoadMore } from "~/components/shared/load-more/load-more.component";
import { PageHeader } from "~/components/shared/page-header/page-header.component";
import { EmptyState, Loading } from "~/components/shared/quip/quip.component";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { QUIPS } from "~/core/constants/quips.constant";

/**
 * Every follow-up: those still to do, soonest first (Home shows only the
 * next few days), or those done, latest first.
 */
export function FollowUpsPage({ view }: { view: FollowUpView }) {
  const list = FollowUpsQuery.useList(view);
  const [target, setTarget] = useState<FollowUpTarget | null>(null);
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <>
      <PageHeader
        title={view === "upcoming" ? "Upcoming" : "Done"}
        actions={
          <Button size="sm" onClick={() => setTarget({ mode: "new" })}>
            <PlusIcon /> <span className="hidden sm:inline">New follow-up</span>
          </Button>
        }
      />
      <GoogleNotice />

      {list.isPending ? (
        <Loading />
      ) : list.error ? (
        <p role="alert" className="text-sm text-destructive">
          {list.error.message}
        </p>
      ) : items.length === 0 ? (
        <div className="py-10">
          {view === "upcoming" ? (
            <EmptyState quips={QUIPS.followUps}>
              Follow-ups you add, or write in your calendar as “! Name: what”, show up here.
            </EmptyState>
          ) : (
            <EmptyState quips={QUIPS.followUpsDone}>Follow-ups you tick off show up here.</EmptyState>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <Card>
            <CardContent>
              <ul className="flex flex-col divide-y">
                {items.map((followUp) => (
                  <li key={followUp.eventId} className="py-3 first:pt-0 last:pb-0">
                    <FollowUpRow followUp={followUp} onEdit={(f) => setTarget({ mode: "edit", followUp: f })} />
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
          <LoadMore hasMore={list.hasNextPage} loading={list.isFetchingNextPage} onLoad={() => void list.fetchNextPage()} />
        </div>
      )}

      <FollowUpDialog target={target} onClose={() => setTarget(null)} />
    </>
  );
}
