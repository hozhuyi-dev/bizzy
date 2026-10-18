import { useState } from "react";
import { PlusIcon } from "lucide-react";
import { FollowUpDialog } from "./components/follow-up-dialog/follow-up-dialog.component";
import { FollowUpRow } from "./components/follow-up-row/follow-up-row.component";
import { FollowUpsQuery } from "./follow-ups.query";
import type { FollowUpList, FollowUpTarget, FollowUpView } from "./follow-ups.types";
import { GoogleNotice } from "~/features/google/components/google-notice/google-notice.component";
import { PageHeader } from "~/components/shared/page-header/page-header.component";
import { EmptyState, Loading } from "~/components/shared/quip/quip.component";
import { Card, CardContent } from "~/components/ui/card";
import { QUIPS } from "~/core/constants/quips.constant";

interface FollowUpsPageProps {
  view: FollowUpList;
  /** The follow-up open to edit, kept in the URL so it can be linked to. */
  open?: string | undefined;
  onOpenChange?: (id: string | undefined) => void;
}

/**
 * Every follow-up: those still to do, soonest first (Home shows only the
 * next few days), or those done, latest first.
 */
export function FollowUpsPage({ view, open, onOpenChange }: FollowUpsPageProps) {
  const list = FollowUpsQuery.useList(view);
  const [adding, setAdding] = useState<FollowUpTarget | null>(null);
  const items = list.data ?? [];
  const opened = open ? items.find((followUp) => followUp.id === open) : undefined;
  const target: FollowUpTarget | null = opened ? { mode: "edit", followUp: opened } : adding;
  const edit = (followUp: FollowUpView) =>
    onOpenChange ? onOpenChange(followUp.id) : setAdding({ mode: "edit", followUp });
  const close = () => {
    setAdding(null);
    if (open) onOpenChange?.(undefined);
  };

  return (
    <>
      <PageHeader
        title={view === "upcoming" ? "Upcoming" : "Done"}
        actions={[
          {
            type: "button",
            label: "New follow-up",
            icon: PlusIcon,
            style: "primary",
            iconOnlyOnPhone: true,
            onClick: () => setAdding({ mode: "new" }),
          },
        ]}
        banners={<GoogleNotice />}
      />

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
        <Card>
          <CardContent>
            <ul className="flex flex-col divide-y">
              {items.map((followUp) => (
                <li key={followUp.id} className="py-3 first:pt-0 last:pb-0">
                  <FollowUpRow followUp={followUp} onEdit={edit} />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <FollowUpDialog target={target} onClose={close} />
    </>
  );
}
