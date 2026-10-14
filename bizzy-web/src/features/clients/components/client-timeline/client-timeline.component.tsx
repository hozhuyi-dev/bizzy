import { FileTextIcon, ReceiptIcon } from "lucide-react";
import type { Client } from "../../clients.types";
import { SessionsQuery } from "~/features/sessions/sessions.query";
import { stageBadges } from "~/features/sessions/session-stage.util";
import { documentLabel, documentRoute } from "~/features/documents/documents.util";
import { LoadMore } from "~/components/shared/load-more/load-more.component";
import { EmptyState, Loading } from "~/components/shared/quip/quip.component";
import { TextLink } from "~/components/shared/text-link/text-link.component";
import { Badge } from "~/components/ui/badge";
import { formatSessionTime } from "~/core/utils/date.util";
import { QUIPS } from "~/core/constants/quips.constant";

/**
 * The client's sessions, newest first, each with what she wrote about it and
 * the documents on it: the story of their care. Read a page at a time, so a
 * client of many years loads as fast as a new one.
 */
export function ClientTimeline({ client }: { client: Client }) {
  const timeline = SessionsQuery.useTimeline(client.id);

  if (timeline.isPending) return <Loading />;
  if (timeline.error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {timeline.error.message}
      </p>
    );
  }
  const sessions = timeline.data.pages.flatMap((page) => page.items);
  if (sessions.length === 0) {
    return <EmptyState quips={QUIPS.timeline}>Sessions with {client.name} show up here, with your notes.</EmptyState>;
  }

  return (
    <div className="flex flex-col gap-3">
      <ol className="relative flex flex-col gap-5 border-l pl-5">
        {sessions.map((session) => (
          <li key={session.id} className="relative">
            <span
              aria-hidden="true"
              className="absolute top-1.5 -left-[1.6rem] size-2.5 rounded-full border-2 border-background bg-muted-foreground"
            />
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <TextLink to="/sessions/$id" params={{ id: session.id }} className="text-sm">
                {formatSessionTime(session.start)}
              </TextLink>
              {stageBadges(session).map((badge) => (
                <Badge key={badge.label} variant={badge.tone}>
                  {badge.label}
                </Badge>
              ))}
            </div>
            {session.record?.summary ? (
              <p className="mt-1 text-sm">{session.record.summary}</p>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground italic">No notes</p>
            )}
            {(session.invoice || session.receipt) && (
              <div className="mt-1 flex flex-wrap gap-3 text-xs">
                {session.invoice && (
                  <TextLink to={documentRoute("invoice")} params={{ id: session.invoice.documentId }} className="inline-flex items-center gap-1 font-normal">
                    <FileTextIcon className="size-3" aria-hidden="true" /> {documentLabel(session.invoice.number, session.invoice.revision)}
                  </TextLink>
                )}
                {session.receipt && (
                  <TextLink to={documentRoute("receipt")} params={{ id: session.receipt.documentId }} className="inline-flex items-center gap-1 font-normal">
                    <ReceiptIcon className="size-3" aria-hidden="true" /> {documentLabel(session.receipt.number, session.receipt.revision)}
                  </TextLink>
                )}
              </div>
            )}
          </li>
        ))}
      </ol>
      <LoadMore hasMore={timeline.hasNextPage} loading={timeline.isFetchingNextPage} onLoad={() => void timeline.fetchNextPage()} />
    </div>
  );
}
