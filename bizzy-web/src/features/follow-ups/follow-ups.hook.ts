import { useCallback } from "react";
import { FollowUpsMutation } from "./follow-ups.mutation";
import type { FollowUpView } from "./follow-ups.types";
import { toastWithQuip } from "~/components/shared/feedback/quip/quip.util";
import { QUIPS } from "~/core/constants/quips.constant";
import { toastRefusal } from "~/features/remedies/components/remedy-buttons/remedy-buttons.component";

/** Marks a follow-up done with an Undo in the toast. */
export function useMarkDone() {
  const { mutate, isPending } = FollowUpsMutation.useSetDone();
  const mark = useCallback(
    (followUp: FollowUpView, done = true) =>
      mutate(
        { id: followUp.id, done },
        {
          onSuccess: () => {
            if (!done) return;
            toastWithQuip("Follow-up done", QUIPS.todoDone, {
              action: { label: "Undo", onClick: () => mutate({ id: followUp.id, done: false }) },
            });
          },
          onError: toastRefusal,
        },
      ),
    [mutate],
  );
  return { mark, isPending };
}
