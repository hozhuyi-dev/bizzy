import { PlusIcon } from "lucide-react";
import type { PipelineStep, StepState } from "../pipeline-layout/pipeline-layout.component";
import type { SessionView } from "../../sessions.types";
import type { FollowUpView } from "~/features/follow-ups/follow-ups.types";
import { FollowUpRow } from "~/features/follow-ups/components/follow-up-row/follow-up-row.component";
import { formatDue, isOverdue } from "~/features/follow-ups/follow-ups.util";
import { EmptyState } from "~/components/shared/feedback/empty-state/empty-state.component";
import { LoadingState } from "~/components/shared/feedback/loading-state/loading-state.component";
import { QUIPS } from "~/core/constants/quips.constant";
import { DataList, DataListItem } from "~/components/shared/list/data-list/data-list.component";

/**
 * Its follow-ups, `undefined` while they load: to do now once one is
 * overdue, ahead while any is open, done once all are. The next visit isn't
 * linked to it, so it isn't here. `onAdd` (without a client, none) is
 * the step's own action, beside its title.
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
  let meta = "Reminders about this session";
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
    actions: onAdd && [{ type: "button", label: "Add follow-up", icon: PlusIcon, onClick: onAdd }],
    content: <FollowUpsStep followUps={followUps} onEdit={onEdit} />,
  };
}

interface FollowUpsStepProps {
  followUps: ReadonlyArray<FollowUpView> | undefined;
  onEdit: (followUp: FollowUpView) => void;
}

function FollowUpsStep({ followUps, onEdit }: FollowUpsStepProps) {
  if (!followUps) return <LoadingState />;
  if (followUps.length === 0) {
    return (
      <EmptyState quips={QUIPS.followUps}>
        Anything to get back to the client about, like results to check. It goes in your calendar as a reminder.
      </EmptyState>
    );
  }
  return (
    <DataList label="Follow-ups">
      {followUps.map((f) => (
        <DataListItem key={f.id}>
          <FollowUpRow followUp={f} onEdit={onEdit} hideClient showSession={false} />
        </DataListItem>
      ))}
    </DataList>
  );
}
