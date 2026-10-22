import { useState } from "react";
import { ChevronUpIcon } from "lucide-react";
import type { ClientView } from "../../clients.types";
import type { FollowUpTarget, FollowUpView } from "~/features/follow-ups/follow-ups.types";
import type { TimelineEntry } from "~/features/timeline/timeline.types";
import type { ListFilter } from "~/core/list/filter.types";
import { TimelineQuery } from "~/features/timeline/timeline.query";
import { TIMELINE_FACETS, entryKey } from "~/features/timeline/timeline.util";
import { TimelineEntryItem } from "~/features/timeline/components/timeline-entry/timeline-entry.component";
import { FollowUpDialog } from "~/features/follow-ups/components/follow-up-dialog/follow-up-dialog.component";
import { FilterBar } from "~/components/shared/list/filter-bar/filter-bar.component";
import { LoadMore } from "~/components/shared/list/load-more/load-more.component";
import { EmptyState } from "~/components/shared/feedback/empty-state/empty-state.component";
import { LoadingState } from "~/components/shared/feedback/loading-state/loading-state.component";
import { Timeline, TimelineGroup, TimelineNow } from "~/components/shared/list/timeline/timeline.component";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { NO_FILTER, isNarrowed, pageItems } from "~/core/list/filter.util";
import { formatMonth, monthKey } from "~/core/utils/date.util";
import { QUIPS } from "~/core/constants/quips.constant";
import { ErrorMessage } from "~/components/shared/feedback/error-message/error-message.component";

/** How many of what is coming show before the rest are asked for: the nearest. */
const UPCOMING_SHOWN = 3;

/**
 * The client's story, newest first along one rail: what is coming above
 * Now (sessions booked, follow-ups waiting), what happened below it, by
 * month, a page at a time. Each session carries what came of it as chips;
 * what belongs to no one session has its own entry.
 */
export function ClientTimeline({ client }: { client: ClientView }) {
  const [filter, setFilter] = useState<ListFilter>(NO_FILTER);
  const pages = TimelineQuery.useSearch(client.id, filter);
  const [followUp, setFollowUp] = useState<FollowUpTarget | null>(null);
  const [allUpcoming, setAllUpcoming] = useState(false);

  const upcoming = pages.data?.pages[0]?.upcoming ?? [];
  const past = pageItems(pages.data);
  const hidden = allUpcoming ? 0 : Math.max(upcoming.length - UPCOMING_SHOWN, 0);
  const onEditFollowUp = (f: FollowUpView) => setFollowUp({ mode: "edit", followUp: f });

  let body;
  if (pages.isPending) body = <LoadingState />;
  else if (pages.error) {
    body = (
      <ErrorMessage>{pages.error.message}</ErrorMessage>
    );
  } else if (upcoming.length === 0 && past.length === 0 && !pages.hasNextPage) {
    body = isNarrowed(filter) ? (
      <EmptyState quips={QUIPS.search}>Nothing in {client.name}'s timeline matches.</EmptyState>
    ) : (
      <EmptyState quips={QUIPS.timeline}>Sessions with {client.name} show up here, with your notes.</EmptyState>
    );
  } else {
    body = (
      <Card>
        <CardContent>
          {hidden > 0 && (
            <Button variant="ghost" size="sm" className="mb-1 ml-8" onClick={() => setAllUpcoming(true)}>
              <ChevronUpIcon /> {hidden} more coming up
            </Button>
          )}
          <Timeline label={`${client.name}'s timeline`}>
            {upcoming.slice(hidden).map((entry) => (
              <TimelineEntryItem key={entryKey(entry)} entry={entry} upcoming onEditFollowUp={onEditFollowUp} />
            ))}
            {upcoming.length > 0 && <TimelineNow />}
            {byMonth(past).map(([month, entries]) => (
              <TimelineGroup key={month} label={formatMonth(month)}>
                {entries.map((entry) => (
                  <TimelineEntryItem key={entryKey(entry)} entry={entry} onEditFollowUp={onEditFollowUp} />
                ))}
              </TimelineGroup>
            ))}
          </Timeline>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <FilterBar label={`Search ${client.name}'s timeline`} value={filter} onChange={setFilter} facets={TIMELINE_FACETS} />
      {body}
      <LoadMore pages={pages} found={past.length > 0} />
      <FollowUpDialog target={followUp} onClose={() => setFollowUp(null)} />
    </div>
  );
}

/** Entries, newest first, in runs of the same month ("2026-10"). */
function byMonth(entries: ReadonlyArray<TimelineEntry>): Array<[string, Array<TimelineEntry>]> {
  const out: Array<[string, Array<TimelineEntry>]> = [];
  for (const entry of entries) {
    const month = monthKey(new Date(entry.at));
    const last = out.at(-1);
    if (last?.[0] === month) last[1].push(entry);
    else out.push([month, [entry]]);
  }
  return out;
}
