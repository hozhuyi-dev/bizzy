import { useMemo, useState } from "react";
import { PlusIcon } from "lucide-react";
import { cn } from "cn";
import { FollowUpDialog } from "./components/follow-up-dialog/follow-up-dialog.component";
import { FollowUpRow } from "./components/follow-up-row/follow-up-row.component";
import { FollowUpsQuery } from "./follow-ups.query";
import type { FollowUpList, FollowUpTarget, FollowUpView } from "./follow-ups.types";
import type { ListFilter } from "~/core/filter/filter.types";
import { ClientsQuery } from "~/features/clients/clients.query";
import { clientFacet } from "~/features/clients/clients.util";
import { GoogleNotice } from "~/features/google/components/google-notice/google-notice.component";
import { FilterBar } from "~/components/shared/filter-bar/filter-bar.component";
import { LoadMore } from "~/components/shared/load-more/load-more.component";
import { PageHeader } from "~/components/shared/page-header/page-header.component";
import { EmptyState, Loading } from "~/components/shared/quip/quip.component";
import { Card, CardContent } from "~/components/ui/card";
import { isNarrowed, pageItems } from "~/core/filter/filter.util";
import { QUIPS } from "~/core/constants/quips.constant";

interface FollowUpsPageProps {
  view: FollowUpList;
  filter: ListFilter;
  onFilterChange: (filter: ListFilter) => void;
  /** The follow-up open to edit, kept in the URL so it can be linked to. */
  open?: string | undefined;
  onOpenChange?: (id: string | undefined) => void;
}

/**
 * Every follow-up: those still to do, soonest first (Home shows only the
 * next few days), or those done, latest due first, a page at a time. Both
 * are searched on the server: by words, client and days.
 */
export function FollowUpsPage({ view, filter, onFilterChange, open, onOpenChange }: FollowUpsPageProps) {
  const clients = ClientsQuery.useList();
  const facets = useMemo(() => [clientFacet(clients.data ?? [])], [clients.data]);
  const list = FollowUpsQuery.useSearch(view, filter);
  const [adding, setAdding] = useState<FollowUpTarget | null>(null);
  const items = useMemo(() => pageItems(list.data), [list.data]);
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
        toolbar={<FilterBar label="Search follow-ups" value={filter} onChange={onFilterChange} facets={facets} dates />}
      />

      {list.isPending ? (
        <Loading />
      ) : list.error ? (
        <p role="alert" className="text-sm text-destructive">
          {list.error.message}
        </p>
      ) : items.length === 0 ? (
        <div className="py-10">
          {isNarrowed(filter) || filter.when || list.hasNextPage ? (
            <>
              <EmptyState quips={QUIPS.search}>No follow-ups found{list.hasNextPage ? " yet" : ""}.</EmptyState>
              <LoadMore pages={list} found={false} />
            </>
          ) : view === "upcoming" ? (
            <EmptyState quips={QUIPS.followUps}>
              Follow-ups you add, or write in your calendar as “! Name: what”, show up here.
            </EmptyState>
          ) : (
            <EmptyState quips={QUIPS.followUpsDone}>Follow-ups you tick off show up here.</EmptyState>
          )}
        </div>
      ) : (
        <Card className={cn("transition-opacity", list.isPlaceholderData && "opacity-60")}>
          <CardContent>
            <ul className="flex flex-col divide-y">
              {items.map((followUp) => (
                <li key={followUp.id} className="py-3 first:pt-0 last:pb-0">
                  <FollowUpRow followUp={followUp} onEdit={edit} />
                </li>
              ))}
            </ul>
            <LoadMore pages={list} found />
          </CardContent>
        </Card>
      )}

      <FollowUpDialog target={target} onClose={close} />
    </>
  );
}
