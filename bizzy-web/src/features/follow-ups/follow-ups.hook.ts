import { useCallback } from "react";
import { toast } from "sonner";
import { FollowUpsMutation } from "./follow-ups.mutation";
import type { FollowUpView } from "./follow-ups.types";
import { toastWithQuip } from "~/components/shared/quip/quip-toast";
import { QUIPS } from "~/core/constants/quips.constant";

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
          onError: (error) => toast.error(error.message),
        },
      ),
    [mutate],
  );
  return { mark, isPending };
}
