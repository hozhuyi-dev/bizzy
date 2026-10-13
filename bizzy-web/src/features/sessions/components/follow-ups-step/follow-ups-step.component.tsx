import { CalendarPlusIcon, PlusIcon } from "lucide-react";
import type { PipelineStep } from "../pipeline-layout/pipeline-layout.component";
import type { Session, SessionDraft } from "../../sessions.types";
import type { Client } from "~/features/clients/clients.types";
import type { FollowUp, FollowUpTarget } from "~/features/follow-ups/follow-ups.types";
import { FollowUpRow } from "~/features/follow-ups/components/follow-up-row/follow-up-row.component";
import { FollowUpsQuery } from "~/features/follow-ups/follow-ups.query";
import { formatDue } from "~/features/follow-ups/follow-ups.util";
import { Loading } from "~/components/shared/quip/quip.component";
import { Button } from "~/components/ui/button";

export function followUpsStep(
  session: Session,
  client: Client | undefined,
  draft: SessionDraft,
  onFollowUp: (target: FollowUpTarget) => void,
  onNextVisit: (draft: SessionDraft) => void,
): PipelineStep {
  return {
    id: "follow-ups",
    title: "Follow-ups",
    state: "optional",
    meta: <FollowUpsMeta sessionId={session.eventId} />,
    actions: client && !session.removedAt && (
      <>
        <Button variant="outline" size="sm" onClick={() => onNextVisit(draft)}>
          <CalendarPlusIcon /> Next visit
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onFollowUp({ mode: "new", clientId: client.id, sessionId: session.eventId })}
        >
          <PlusIcon /> Follow-up
        </Button>
      </>
    ),
    content: <FollowUpsStep sessionId={session.eventId} onEdit={(f) => onFollowUp({ mode: "edit", followUp: f })} />,
  };
}

function FollowUpsMeta({ sessionId }: { sessionId: string }) {
  const followUps = FollowUpsQuery.useBySession(sessionId);
  const open = (followUps.data ?? []).filter((f) => !f.doneAt);
  const [first] = open;
  if (!first) return <>{followUps.data?.length ? "All done" : "Reminders and the next visit"}</>;
  return <>{open.length === 1 ? `Due ${formatDue(first)}` : `${open.length}, next ${formatDue(first)}`}</>;
}

function FollowUpsStep({ sessionId, onEdit }: { sessionId: string; onEdit: (followUp: FollowUp) => void }) {
  const followUps = FollowUpsQuery.useBySession(sessionId);
  if (followUps.isPending) return <Loading />;
  if (!followUps.data?.length) {
    return (
      <p className="text-sm text-muted-foreground">
        Anything to get back to the client about, like results to check. It goes in your calendar as a reminder.
      </p>
    );
  }
  return (
    <ul className="flex flex-col divide-y">
      {followUps.data.map((f) => (
        <li key={f.eventId} className="py-3 first:pt-0 last:pb-0">
          <FollowUpRow followUp={f} onEdit={onEdit} hideClient showSession={false} />
        </li>
      ))}
    </ul>
  );
}
