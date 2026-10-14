import { toast } from "sonner";
import { FollowUpsMutation } from "./follow-ups.mutation";
import type { FollowUp } from "./follow-ups.types";

/** Marks a follow-up done with an Undo in the toast. */
export function useMarkDone() {
  const { mutate, isPending } = FollowUpsMutation.useSetDone();
  const mark = (followUp: FollowUp, done = true) =>
    mutate(
      { id: followUp.id, done },
      {
        onSuccess: () => {
          if (!done) return;
          toast.success("Follow-up done", {
            action: { label: "Undo", onClick: () => mutate({ id: followUp.id, done: false }) },
          });
        },
        onError: (error) => toast.error(error.message),
      },
    );
  return { mark, isPending };
}
