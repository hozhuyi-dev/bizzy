import { toast } from "sonner";
import { toSessionFields } from "./sessions.form";
import { SessionsMutation } from "./sessions.mutation";
import type { SessionDraft, SessionView } from "./sessions.types";
import { toastRefusal } from "~/features/remedies/components/remedy-buttons/remedy-buttons.component";
import { toastWithQuip } from "~/components/shared/quip/quip-toast";
import { QUIPS } from "~/core/constants/quips.constant";

/**
 * Saves a booking from its form: a new session, or what changed on one
 * (`was`, the booking it was edited from). The API decides it: saved, or
 * refused with why and what would let it through, which rejects so the
 * form stays as the user left it.
 */
export function useBookingSave(
  session: SessionView | undefined,
  was: SessionDraft | undefined,
  onSaved: (draft: SessionDraft, id: string) => void,
) {
  const create = SessionsMutation.useCreate();
  const update = SessionsMutation.useUpdate();

  const submit = async (draft: SessionDraft, updatePayment = false) => {
    if (session) {
      const fields = { ...toSessionFields(draft, was), ...(updatePayment ? { updatePayment } : {}) };
      await update.mutateAsync({ id: session.id, fields });
      onSaved(draft, session.id);
    } else {
      const created = await create.mutateAsync(toSessionFields(draft));
      onSaved(draft, created.id);
    }
  };

  return { submit, saving: create.isPending || update.isPending };
}

/**
 * Confirms a tentative booking in one tap (the to-do list, the sessions
 * table): it removes the question mark, keeping the rest, with an Undo in
 * the toast. Rejects with the refusal, for the caller to show with its
 * remedies.
 */
export function useConfirmBooking() {
  const update = SessionsMutation.useUpdate();

  const confirm = async (id: string) => {
    await update.mutateAsync({ id, fields: { tentative: false } });
    toastWithQuip("Confirmed", QUIPS.todoDone, {
      action: {
        label: "Undo",
        onClick: () => update.mutate({ id, fields: { tentative: true } }, { onError: toastRefusal }),
      },
    });
  };

  return { confirm, pending: update.isPending };
}
