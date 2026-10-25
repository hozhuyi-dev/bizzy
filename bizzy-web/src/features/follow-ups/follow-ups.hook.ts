import { useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import { FollowUpsMutation } from "./follow-ups.mutation";
import type { FollowUpTarget, FollowUpView } from "./follow-ups.types";
import { toastWithQuip } from "~/components/shared/feedback/quip/quip.util";
import { QUIPS } from "~/core/constants/quips.constant";
import { toastRefusal } from "~/features/remedies/components/remedy-buttons/remedy-buttons.component";

/** Marks a follow-up done with an Undo in the toast; `then` once it is (or not done). */
export function useMarkDone() {
  const { mutate, isPending } = FollowUpsMutation.useSetDone();
  const mark = useCallback(
    (followUp: FollowUpView, done = true, then?: () => void) =>
      mutate(
        { id: followUp.id, done },
        {
          onSuccess: () => {
            then?.();
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

/**
 * Opens a follow-up's page: one to edit, or a new one, for a client and
 * from a session when given (kept in history, not the URL: see HistoryState).
 */
export function useOpenFollowUp(): (target: FollowUpTarget) => void {
  const navigate = useNavigate();
  return useCallback(
    (target: FollowUpTarget) =>
      target.mode === "edit"
        ? void navigate({ to: "/follow-ups/$id", params: { id: target.followUp.id } })
        : void navigate({ to: "/follow-ups/new", state: { clientId: target.clientId, sessionId: target.sessionId } }),
    [navigate],
  );
}
