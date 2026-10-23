import { useCallback, useMemo, useState } from "react";
import { PlusIcon } from "lucide-react";
import { cn } from "cn";
import { FollowUpDialog } from "./components/follow-up-dialog/follow-up-dialog.component";
import { FollowUpsTable } from "./components/follow-ups-table/follow-ups-table.component";
import { FollowUpsQuery } from "./follow-ups.query";
import { FOLLOW_UP_ORIGIN_FACET, FOLLOW_UP_STATUS_FACET } from "./follow-ups.constant";
import { FOLLOW_UP_PRESETS } from "./follow-ups.util";
import type { FollowUpTarget, FollowUpView } from "./follow-ups.types";
import type { ListFilter } from "~/core/list/filter.types";
import { ClientsQuery } from "~/features/clients/clients.query";
import { clientFacet } from "~/features/clients/clients.util";
import { FilterBar } from "~/components/shared/list/filter-bar/filter-bar.component";
import { LoadMore } from "~/components/shared/list/load-more/load-more.component";
import { PageHeader } from "~/components/shared/layout/page-header/page-header.component";
import { EmptyState } from "~/components/shared/feedback/empty-state/empty-state.component";
import { isNarrowed, pageItems } from "~/core/list/filter.util";
import { QUIPS } from "~/core/constants/quips.constant";

interface FollowUpsPageProps {
  filter: ListFilter;
  onFilterChange: (filter: ListFilter) => void;
  /** The follow-up open to edit, kept in the URL so it can be linked to. */
  open?: string | undefined;
  onOpenChange?: (id: string | undefined) => void;
}

/**
 * Every follow-up, a page at a time: those still to do by default, soonest
 * first (Home shows only the next few days); overdue or done ones, or all,
 * by status. Searched on the server: by words, client, status, where they
 * came from and days.
 */
export function FollowUpsPage({ filter, onFilterChange, open, onOpenChange }: FollowUpsPageProps) {
  const clients = ClientsQuery.useList();
  const facets = useMemo(
    () => [FOLLOW_UP_STATUS_FACET, clientFacet(clients.data ?? []), FOLLOW_UP_ORIGIN_FACET],
    [clients.data],
  );
  const list = FollowUpsQuery.useSearch(filter);
  const onlyDone = filter.chips.status?.length === 1 && filter.chips.status[0] === "done";
  const [adding, setAdding] = useState<FollowUpTarget | null>(null);
  const items = useMemo(() => pageItems(list.data), [list.data]);
  const opened = open ? items.find((followUp) => followUp.id === open) : undefined;
  const target: FollowUpTarget | null = opened ? { mode: "edit", followUp: opened } : adding;
  const edit = useCallback(
    (followUp: FollowUpView) => (onOpenChange ? onOpenChange(followUp.id) : setAdding({ mode: "edit", followUp })),
    [onOpenChange],
  );
  const close = () => {
    setAdding(null);
    if (open) onOpenChange?.(undefined);
  };

  return (
    <>
      <PageHeader
        title="Follow-ups"
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
        toolbar={
          <FilterBar
            label="Search follow-ups"
            value={filter}
            onChange={onFilterChange}
            facets={facets}
            presets={FOLLOW_UP_PRESETS}
            dates
          />
        }
      />

      <div className={cn("transition-opacity", list.isPlaceholderData && "opacity-60")}>
          <FollowUpsTable
            followUps={items}
            source={list}
            onEdit={edit}
            empty={
              onlyDone ? (
                <EmptyState quips={QUIPS.followUpsDone}>Follow-ups you tick off show up here.</EmptyState>
              ) : isNarrowed(withoutStatus(filter)) || filter.when || list.hasNextPage ? (
                <EmptyState quips={QUIPS.search}>No follow-ups found{list.hasNextPage ? " yet" : ""}.</EmptyState>
              ) : (
                <EmptyState quips={QUIPS.followUps}>
                  Follow-ups you add, or write in your calendar as “! Name: what”, show up here.
                </EmptyState>
              )
            }
          />
          <LoadMore pages={list} found={items.length > 0} />
        </div>

      <FollowUpDialog target={target} onClose={close} />
    </>
  );
}

/** The filter but its status: what narrows it beyond the usual. */
function withoutStatus(filter: ListFilter): ListFilter {
  return { ...filter, chips: { ...filter.chips, status: [] } };
}
