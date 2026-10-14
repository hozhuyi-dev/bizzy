import { toast } from "sonner";
import { SessionsMutation } from "./sessions.mutation";
import { SessionsService } from "./sessions.service";
import type { Session, SessionDraft } from "./sessions.types";
import { toastRefusal } from "~/features/remedies/components/remedy-buttons/remedy-buttons.component";

/**
 * Saves a booking from its form. The API decides it: saved, or refused with
 * why and what would let it through (shown with its remedies), which
 * rejects so the form stays as she left it.
 */
export function useBookingSave(session: Session | undefined, onSaved: (draft: SessionDraft, id: string) => void) {
  const create = SessionsMutation.useCreate();
  const update = SessionsMutation.useUpdate();

  const submit = async (draft: SessionDraft, updatePayment = false) => {
    try {
      if (session) {
        await update.mutateAsync({ id: session.id, draft, updatePayment });
        onSaved(draft, session.id);
      } else {
        const created = await create.mutateAsync(draft);
        onSaved(draft, created.id);
      }
    } catch (error) {
      toastRefusal(error);
      throw error;
    }
  };

  return { submit, saving: create.isPending || update.isPending };
}

/**
 * Confirms a tentative booking in one tap (the to-do list, the sessions
 * table): it removes the question mark, keeping the rest. A refusal says
 * why, with its remedies.
 */
export function useConfirmBooking() {
  const update = SessionsMutation.useUpdate();

  const confirmBooking = async (id: string) => {
    const { draft } = await SessionsService.get(id);
    await update.mutateAsync({ id, draft: { ...draft, tentative: false } });
    toast.success("Confirmed");
  };

  return {
    confirm: (id: string) => void confirmBooking(id).catch(toastRefusal),
    pending: update.isPending,
  };
}
