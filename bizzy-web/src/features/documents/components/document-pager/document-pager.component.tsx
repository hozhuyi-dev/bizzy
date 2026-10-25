import { useMemo } from "react";
import { documentLink } from "../../documents.columns";
import { DOCUMENTS_LIST } from "../../documents.list";
import { documentPlace, documentsLink, documentsUrl } from "../../documents.util";
import type { DocumentSearch, DocumentType, DocumentView } from "../../documents.types";
import type { ListFilter } from "~/core/list/filter.types";
import type { Parent } from "~/components/shared/layout/page-header/page-header.component";
import { ListPager } from "~/components/shared/list/list-pager/list-pager.component";
import { NO_FILTER } from "~/core/list/filter.util";
import { packageDocumentsList } from "~/features/packages/packages.list";
import { sessionDocumentsList } from "~/features/sessions/sessions.list";
import { timelineList, timelineParent } from "~/features/timeline/timeline.list";

/** Where a document was opened from, when that isn't the documents list (DocumentSearch). */
export type DocumentWithin = Pick<DocumentSearch, "session" | "package" | "timeline">;

/**
 * The list a document's page steps through, as its breadcrumb: the
 * session's, package's or client's page it was opened from, else the
 * documents list with its filter.
 */
export function documentParent(within: DocumentWithin, filter: ListFilter): Parent {
  if (within.session) return { to: "/sessions/$id", params: { id: within.session }, label: "Session" };
  if (within.package) return { to: "/packages/$id", params: { id: within.package }, label: "Package" };
  if (within.timeline) return timelineParent(within.timeline);
  return documentsLink(filter);
}

interface DocumentPagerProps {
  id: string;
  type: DocumentType;
  /** The document, once loaded: where it would sit in a list it isn't in. */
  doc?: DocumentView | undefined;
  /** It isn't there (deleted): steps go into the list. */
  gone?: boolean | undefined;
  within: DocumentWithin;
  filter: ListFilter;
  onFilterChange: (filter: ListFilter) => void;
}

/**
 * Steps through the list the document was opened from: a session's or a
 * package's documents, in the order its page lists them, the documents in
 * a client's timeline, or the documents list with its filter. A step to
 * one of the other type lands on its own page (see DocumentPage).
 */
export function DocumentPager({ id, type, doc, gone, within, filter, onFilterChange }: DocumentPagerProps) {
  const { session, package: pkg, timeline } = within;
  const ofItem = useMemo(
    () => (session ? sessionDocumentsList(session) : pkg ? packageDocumentsList(pkg) : undefined),
    [session, pkg],
  );
  const ofTimeline = useMemo(() => timeline && timelineList(timeline, "document"), [timeline]);
  const itemLink = (next: string) => documentLink({ id: next, type }, within);
  if (ofItem) {
    return <ListPager key={session ?? pkg} list={ofItem} filter={NO_FILTER} current={{ id, gone }} itemLink={itemLink} />;
  }
  if (ofTimeline) {
    return <ListPager key={timeline} list={ofTimeline} filter={NO_FILTER} current={{ id, gone }} itemLink={itemLink} />;
  }
  return (
    <ListPager
      key="documents"
      list={DOCUMENTS_LIST}
      filter={filter}
      current={{ id, place: doc && documentPlace(doc), gone }}
      itemLink={(next) => documentLink({ id: next, type }, documentsUrl.toSearch(filter))}
      panel={{ onApply: onFilterChange, listLink: documentsLink }}
    />
  );
}
