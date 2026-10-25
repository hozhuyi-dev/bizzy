import { TimelineQuery } from "./timeline.query";
import type { InfiniteData } from "@tanstack/react-query";
import type { TimelineEntry, TimelineKind, TimelinePage } from "./timeline.types";
import type { PagerList } from "~/core/list/pager.types";
import type { Parent } from "~/components/shared/layout/page-header/page-header.component";
import { NO_FILTER } from "~/core/list/filter.util";
import { usePagesWindowOf } from "~/core/list/pager.hook";

/** The id of the item an entry is. */
function entryId(entry: TimelineEntry): string {
  switch (entry.kind) {
    case "session":
      return entry.session.id;
    case "followUp":
      return entry.followUp.id;
    case "document":
      return entry.document.id;
    case "package":
      return entry.package.id;
  }
}

const NOUNS: Record<TimelineKind, [string, string]> = {
  session: ["session", "sessions"],
  followUp: ["follow-up", "follow-ups"],
  document: ["document", "documents"],
  package: ["package", "packages"],
};

/** One kind's ids in a timeline's pages, in its order: what is coming, then what happened, newest first. */
function idsOfKind(kind: TimelineKind) {
  return (data: InfiniteData<TimelinePage> | undefined): Array<string> =>
    [...(data?.pages[0]?.upcoming ?? []), ...(data?.pages.flatMap((page) => page.items) ?? [])]
      .filter((entry) => entry.kind === kind)
      .map(entryId);
}

// Made once each: a window reads its items again only when this changes.
const IDS_OF: Record<TimelineKind, ReturnType<typeof idsOfKind>> = {
  session: idsOfKind("session"),
  followUp: idsOfKind("followUp"),
  document: idsOfKind("document"),
  package: idsOfKind("package"),
};

/**
 * A client's timeline, as their page shows it, for an entry's page to step
 * through its kind's entries: read from the pages the client's page read,
 * and on as far as a step takes it. A timeline filtered on the client's
 * page is stepped through whole.
 */
export function timelineList(clientId: string, kind: TimelineKind): PagerList<string> {
  const [noun, nouns] = NOUNS[kind];
  return {
    noun,
    nouns,
    useWindow: () => usePagesWindowOf(TimelineQuery.useSearch(clientId, NO_FILTER), IDS_OF[kind]),
    idOf: (id) => id,
  };
}

/** The client's page, whose timeline an entry's page steps through: its breadcrumb. */
export function timelineParent(clientId: string): Parent {
  return { to: "/clients/$id", params: { id: clientId }, label: "Timeline" };
}
