import { useRef, useState } from "react";
import { toast } from "sonner";
import { SessionsMutation } from "./sessions.mutation";
import { SessionsService } from "./sessions.service";
import type { Session, SessionDraft } from "./sessions.types";
import type { Impact } from "~/features/billing/billing.types";
import { useImpactSave } from "~/features/billing/billing.hook";
import { ImpactDialog } from "~/features/billing/components/impact-dialog/impact-dialog.component";
import { Checkbox } from "~/components/ui/checkbox";
import { Field, FieldContent, FieldDescription, FieldLabel } from "~/components/ui/field";

/**
 * Saves a booking from its form: its preview first (sessions.impact), and
 * what that brings on waits in `dialog` for her to confirm. When the change
 * leaves what was paid for it short or over, the dialog offers to update the
 * payment with it. Resolves once saved or waiting; a refusal (a fee to
 * enter, an issued document it would contradict) rejects with why.
 */
export function useBookingSave(session: Session | undefined, onSaved: (draft: SessionDraft, eventId: string) => void) {
  const create = SessionsMutation.useCreate();
  const update = SessionsMutation.useUpdate();
  const save = useImpactSave();
  const [updatePayment, setUpdatePayment] = useState(false);
  const repricing = useRef(false);

  const send = async (draft: SessionDraft, confirm: boolean) => {
    const options = { confirm, updatePayment: repricing.current };
    if (session) {
      await update.mutateAsync({ eventId: session.eventId, draft, options });
      onSaved(draft, session.eventId);
    } else {
      const created = await create.mutateAsync({ draft, options });
      onSaved(draft, created.eventId);
    }
  };

  const submit = async (draft: SessionDraft) => {
    repricing.current = false;
    setUpdatePayment(false);
    const outcome = await save.run(
      () => SessionsService.impact(session?.eventId, draft),
      (confirm) => send(draft, confirm),
    );
    if (outcome.kind === "refused") throw new Error(outcome.impact.refused);
  };

  const dialog = (
    <ImpactDialog
      impact={save.impact}
      saving={save.saving}
      onConfirm={() => void save.confirm().catch((error: Error) => toast.error(error.message))}
      onCancel={save.cancel}
    >
      {session && changesWhatWasPaid(save.impact, session.eventId) && (
        <Field orientation="horizontal">
          <Checkbox
            id="update-payment"
            checked={updatePayment}
            onCheckedChange={(checked) => {
              repricing.current = checked;
              setUpdatePayment(checked);
            }}
          />
          <FieldContent>
            <FieldLabel htmlFor="update-payment">Update the payment too</FieldLabel>
            <FieldDescription>
              What was paid moves to the new amount, as what you collected or refunded with the change.
            </FieldDescription>
          </FieldContent>
        </Field>
      )}
    </ImpactDialog>
  );

  return { submit, dialog, saving: create.isPending || update.isPending };
}

/** The impact changes what was paid for the session, or the package it bought. */
function changesWhatWasPaid(impact: Impact | null, eventId: string): boolean {
  return (impact?.brings ?? []).some(
    (b) =>
      b.id === eventId &&
      ((b.kind === "session" && b.rule === "fee-changed-after-payment") ||
        (b.kind === "package" && b.rule === "price-changed-after-payment")),
  );
}

/**
 * Confirms a tentative booking in one tap (the to-do list, the sessions
 * table): it removes the question mark, keeping the rest, through the same
 * preview. A refusal (it needs a fee entered, or would contradict an issued
 * document) says why; the session's page is where to sort it out.
 */
export function useConfirmBooking() {
  const update = SessionsMutation.useUpdate();
  const save = useImpactSave();

  const confirmBooking = async (eventId: string) => {
    const { draft } = await SessionsService.get(eventId);
    const next = { ...draft, tentative: false };
    const outcome = await save.run(
      () => SessionsService.impact(eventId, next),
      async (confirm) => {
        await update.mutateAsync({ eventId, draft: next, options: { confirm } });
        toast.success("Confirmed");
      },
    );
    if (outcome.kind === "refused") toast.error(outcome.impact.refused);
  };

  return {
    confirm: (eventId: string) => void confirmBooking(eventId).catch((error: Error) => toast.error(error.message)),
    pending: update.isPending,
    dialog: (
      <ImpactDialog
        impact={save.impact}
        saving={save.saving}
        confirmLabel="Confirm anyway"
        onConfirm={() => void save.confirm().catch((error: Error) => toast.error(error.message))}
        onCancel={save.cancel}
      />
    ),
  };
}
