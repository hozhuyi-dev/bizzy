import { useCallback, useState } from "react";
import { toast } from "sonner";
import { feesChanged } from "./clients.form";
import { ClientsMutation } from "./clients.mutation";
import type { Client, SaveClientInput } from "./clients.types";
import type { FeeImpact } from "~/features/billing/billing.types";
import { BillingService } from "~/features/billing/billing.service";

/**
 * Saves a client. New fees are priced first: when they would reprice a
 * session already paid or on a document, the save waits in `pending` for
 * her to confirm or cancel.
 */
export function useSaveClient(client: Client | undefined, onSaved: (saved: Client) => void) {
  const save = ClientsMutation.useSave();
  const [pending, setPending] = useState<{ input: SaveClientInput; impact: FeeImpact } | null>(null);

  const commit = useCallback(
    async (input: SaveClientInput, repriced: number) => {
      try {
        const saved = await save.mutateAsync(input);
        const note = repriced > 0 ? ` · ${repriced} ${repriced === 1 ? "session" : "sessions"} repriced` : "";
        toast.success(`${client ? "Client updated" : "Client added"}${note}`);
        onSaved(saved);
      } catch {
        // Shown through error.
      } finally {
        setPending(null);
      }
    },
    [client, onSaved, save],
  );

  const submit = useCallback(
    async (input: SaveClientInput) => {
      let repriced = 0;
      if (client && feesChanged(client, input.feeRates ?? [])) {
        try {
          const impact = await BillingService.feeImpact({ clientId: client.id, feeRates: input.feeRates ?? [] });
          if (impact.needsConfirm) {
            setPending({ input, impact });
            return;
          }
          repriced = impact.changes.length;
        } catch {
          // Saving reports the same problem through error.
        }
      }
      await commit(input, repriced);
    },
    [client, commit],
  );

  return {
    submit,
    /** New fees waiting for her to confirm what they reprice. */
    impact: pending?.impact ?? null,
    confirm: () => pending && void commit(pending.input, pending.impact.changes.length),
    cancel: () => setPending(null),
    isSaving: save.isPending,
    error: save.error,
  };
}
