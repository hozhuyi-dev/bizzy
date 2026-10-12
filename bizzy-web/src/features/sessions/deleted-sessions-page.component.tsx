import { useState } from "react";
import { toast } from "sonner";
import { RotateCcwIcon, Trash2Icon } from "lucide-react";
import { allSessionDocuments } from "./session-stage";
import { SessionsMutation } from "./sessions.mutation";
import { SessionsQuery } from "./sessions.query";
import type { Session } from "./sessions.types";
import { ClientsQuery } from "~/features/clients/clients.query";
import { PackagesQuery } from "~/features/packages/packages.query";
import { PageHeader } from "~/components/shared/page-header/page-header.component";
import { EmptyState, Loading } from "~/components/shared/quip/quip.component";
import { TextLink } from "~/components/shared/text-link/text-link.component";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { formatDate, formatSessionTime } from "~/core/utils/date.util";
import { QUIPS } from "~/core/constants/quips.constant";

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
      <DiscardDialog session={discarding} onClose={() => setDiscarding(null)} />
    </>
  );
}

function DeletedRow({ session, onDiscard }: { session: Session; onDiscard: (session: Session) => void }) {
  const clientsById = ClientsQuery.useById();
  const restore = SessionsMutation.useRestore();
  const client = session.clientId ? clientsById.get(session.clientId) : undefined;

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

/** Discarding drops what she recorded; a document must be cancelled first. */
export function DiscardDialog({
  session,
  onClose,
  onDiscarded,
}: {
  session: Session | null;
  onClose: () => void;
  onDiscarded?: () => void;
}) {
  const discard = SessionsMutation.useDiscard();
  const packages = PackagesQuery.useList(true);
  const bought = session ? packages.data?.find((pkg) => pkg.id === session.eventId) : undefined;
  const documents = session ? allSessionDocuments(session, bought) : [];

  return (
    <AlertDialog open={session !== null} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Discard this session?</AlertDialogTitle>
          <AlertDialogDescription>
            {documents.length > 0
              ? "An invoice or receipt covers it. Cancel or discard those first."
              : "Its notes and payment are deleted for good. It is already gone from your calendar."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={discard.isPending || documents.length > 0}
            onClick={() =>
              session &&
              discard.mutate(session.eventId, {
                onSuccess: () => {
                  toast.success("Session discarded");
                  onDiscarded?.();
                },
                onError: (error) => toast.error(error.message),
                onSettled: onClose,
              })
            }
          >
            Discard
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
