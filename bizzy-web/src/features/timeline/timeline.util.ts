import { KIND_FACET, TIMELINE_KINDS } from "./timeline.constant";
import type { SearchTimelineRequest, TimelineEntry, TimelineKind } from "./timeline.types";
import type { Facet, ListFilter } from "~/core/list/filter.types";
import { listRequest } from "~/core/list/filter.util";

/** What a timeline can be narrowed by besides words: the kinds of entry. */
export const TIMELINE_FACETS: ReadonlyArray<Facet> = [
  {
    key: KIND_FACET,
    label: "Show",
    options: Object.entries(TIMELINE_KINDS).map(([value, label]) => ({ value, label })),
  },
];

/** What a client's timeline asks the API for: a short page, as each session reads its documents and follow-ups. */
export function searchTimelineRequest(clientId: string, filter: ListFilter): SearchTimelineRequest {
  return {
    ...listRequest(filter),
    limit: 20,
    clientId,
    kinds: [...(filter.chips[KIND_FACET] ?? [])] as Array<TimelineKind>,
  };
}

/** An entry's key in a list: its kind and id. */
export function entryKey(entry: TimelineEntry): string {
  switch (entry.kind) {
    case "session":
      return `session:${entry.session.id}`;
    case "followUp":
      return `followUp:${entry.followUp.id}`;
    case "document":
      return `document:${entry.document.id}`;
    case "package":
      return `package:${entry.package.id}`;
  }
}
