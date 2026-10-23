import { CheckIcon, RotateCcwIcon } from "lucide-react";
import { useMarkDone } from "../../follow-ups.hook";
import type { FollowUpView } from "../../follow-ups.types";
import { Button } from "~/components/ui/button";

/**
 * Done on a follow-up waiting, Not done on one done: the one button a
 * follow-up has wherever it is listed; a click on its row edits it.
 */
export function FollowUpDoneButton({ followUp }: { followUp: FollowUpView }) {
  const { mark, isPending } = useMarkDone();
  return followUp.doneAt ? (
    <Button size="sm" variant="outline" disabled={isPending} onClick={() => mark(followUp, false)}>
      <RotateCcwIcon /> Not done
    </Button>
  ) : (
    <Button size="sm" variant="outline" disabled={isPending} onClick={() => mark(followUp)}>
      <CheckIcon /> Done
    </Button>
  );
}
