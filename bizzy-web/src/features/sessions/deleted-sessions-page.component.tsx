import { useState } from "react";
import { toast } from "sonner";
import { RotateCcwIcon, Trash2Icon } from "lucide-react";
import { DiscardSessionDialog } from "./components/discard-session-dialog/discard-session-dialog.component";
import { SessionsMutation } from "./sessions.mutation";
import { SessionsQuery } from "./sessions.query";
import type { Session } from "./sessions.types";
import { ClientsQuery } from "~/features/clients/clients.query";
import { PageHeader } from "~/components/shared/page-header/page-header.component";
import { EmptyState, Loading } from "~/components/shared/quip/quip.component";
import { TextLink } from "~/components/shared/text-link/text-link.component";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { formatDate, formatSessionTime } from "~/core/utils/date.util";
import { QUIPS } from "~/core/constants/quips.constant";
import { clientOf } from "~/features/clients/clients.util";

/**
 * Sessions deleted from the calendar that had notes, a payment or a document
 * on them, so they were kept: restore one (its event comes back) or discard
 * it with what was recorded.
 */
export function DeletedSessionsPage() {
  const removed = SessionsQuery.useRemoved();
  const [discarding, setDiscarding] = useState<Session | null>(null);

  return (
    <>
      <PageHeader title="Deleted" />
      {removed.isPending ? (
        <Loading />
      ) : removed.error ? (
        <p role="alert" className="text-sm text-destructive">
          {removed.error.message}
        </p>
      ) : removed.data.length === 0 ? (
        <div className="py-10">
          <EmptyState quips={QUIPS.sessionsDeleted}>
            A session deleted from your calendar with notes or a payment on it is kept here.
          </EmptyState>
        </div>
      ) : (
        <Card>
          <CardContent>
            <ul className="flex flex-col divide-y">
              {removed.data.map((session) => (
                <li key={session.eventId} className="py-3 first:pt-0 last:pb-0">
                  <DeletedRow session={session} onDiscard={setDiscarding} />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      <DiscardSessionDialog session={discarding} onClose={() => setDiscarding(null)} />
    </>
  );
}

function DeletedRow({ session, onDiscard }: { session: Session; onDiscard: (session: Session) => void }) {
  const clientsById = ClientsQuery.useById();
  const restore = SessionsMutation.useRestore();
  const client = clientOf(clientsById, session.clientId);

  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <TextLink to="/sessions/$id" params={{ id: session.eventId }}>
          {client?.name ?? (session.name || session.title)}
        </TextLink>
        <span className="text-sm text-muted-foreground">
          {formatSessionTime(session.start)}
          {session.record?.summary && ` · ${session.record.summary}`}
        </span>
        {session.removedAt && (
          <span className="text-xs text-muted-foreground">Deleted from the calendar {formatDate(session.removedAt)}</span>
        )}
      </div>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={restore.isPending}
          onClick={() =>
            restore.mutate(session.eventId, {
              onSuccess: () => toast.success("Session restored to your calendar"),
              onError: (error) => toast.error(error.message),
            })
          }
        >
          <RotateCcwIcon /> Restore
        </Button>
        <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => onDiscard(session)}>
          <Trash2Icon /> Discard
        </Button>
      </div>
    </div>
  );
}
