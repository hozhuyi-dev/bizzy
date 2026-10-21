import { PlusIcon } from "lucide-react";
import type { PipelineStep, StepState } from "../pipeline-layout/pipeline-layout.component";
import type { SessionView } from "../../sessions.types";
import type { FollowUpView } from "~/features/follow-ups/follow-ups.types";
import { FollowUpRow } from "~/features/follow-ups/components/follow-up-row/follow-up-row.component";
import { formatDue, isOverdue } from "~/features/follow-ups/follow-ups.util";
import { Loading } from "~/components/shared/quip/quip.component";
import { RowList, RowListItem } from "~/components/shared/row-list/row-list.component";
import { Button } from "~/components/ui/button";

/**
 * Its follow-ups, `undefined` while they load: to do now once one is
 * overdue, ahead while any is open, done once all are. Adding one, or the
 * next visit, is in the page's header; `onAdd` (without a client, none) is
 * the way in from an empty list too.
 */
export function followUpsStep(
  session: SessionView,
  followUps: ReadonlyArray<FollowUpView> | undefined,
  onAdd: (() => void) | undefined,
  onEdit: (followUp: FollowUpView) => void,
): PipelineStep {
  const all = followUps ?? [];
  const open = all.filter((f) => !f.doneAt).sort((a, b) => a.due.localeCompare(b.due));
  const overdue = open.filter((f) => isOverdue(f));
  const [next] = open;
  const [late] = overdue;

  let state: StepState = "optional";
  let meta = "Reminders and the next visit";
  if (late) {
    state = "current";
    meta = overdue.length === 1 ? `Overdue since ${formatDue(late)}` : `${overdue.length} overdue, since ${formatDue(late)}`;
  } else if (next) {
    state = "todo";
    meta = open.length === 1 ? `Due ${formatDue(next)}` : `${open.length} open, next ${formatDue(next)}`;
  } else if (all.length > 0) {
    state = "done";
    meta = all.length === 1 ? "Done" : `All ${all.length} done`;
  }

  return {
    id: "follow-ups",
    title: "Follow-ups",
    state,
    meta: late ? <span className="text-status-attention-foreground">{meta}</span> : meta,
    count: open.length,
    content: <FollowUpsStep followUps={followUps} onAdd={onAdd} onEdit={onEdit} />,
  };
}

interface FollowUpsStepProps {
  followUps: ReadonlyArray<FollowUpView> | undefined;
  onAdd: (() => void) | undefined;
  onEdit: (followUp: FollowUpView) => void;
}

function FollowUpsStep({ followUps, onAdd, onEdit }: FollowUpsStepProps) {
  if (!followUps) return <Loading />;
  if (followUps.length === 0) {
    return (
      <>
        <p className="text-sm text-muted-foreground">
          Anything to get back to the client about, like results to check. It goes in your calendar as a reminder.
        </p>
        {onAdd && (
          <div>
            <Button variant="outline" size="sm" onClick={onAdd}>
              <PlusIcon /> Add follow-up
            </Button>
          </div>
        )}
      </>
    );
  }
  return (
    <RowList label="Follow-ups">
      {followUps.map((f) => (
        <RowListItem key={f.id}>
          <FollowUpRow followUp={f} onEdit={onEdit} hideClient showSession={false} />
        </RowListItem>
      ))}
    </RowList>
  );
}
