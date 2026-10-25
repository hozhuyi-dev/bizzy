import { CheckIcon, RotateCcwIcon } from "lucide-react";
import { useMarkDone } from "../../follow-ups.hook";
import type { FollowUpView } from "../../follow-ups.types";
import { PendingButton } from "~/components/shared/actions/pending-button/pending-button.component";

/**
 * Done on a follow-up waiting, Not done on one done: the one button a
 * follow-up has wherever it is listed; a click on its row edits it.
 */
export function FollowUpDoneButton({ followUp }: { followUp: FollowUpView }) {
  const { mark, isPending } = useMarkDone();
  return followUp.doneAt ? (
    <PendingButton size="sm" variant="outline" pending={isPending} onClick={() => mark(followUp, false)}>
      <RotateCcwIcon /> Not done
    </PendingButton>
  ) : (
    <PendingButton size="sm" variant="outline" pending={isPending} onClick={() => mark(followUp)}>
      <CheckIcon /> Done
    </PendingButton>
  );
}
