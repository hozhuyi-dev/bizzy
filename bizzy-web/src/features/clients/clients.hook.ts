import { useState } from "react";
import { toast } from "sonner";
import { feesChanged } from "./clients.form";
import { ClientsMutation } from "./clients.mutation";
import { ClientsService } from "./clients.service";
import type { Client, SaveClientInput } from "./clients.types";
import type { FeeImpact, Impact } from "~/features/billing/billing.types";
import { BillingService } from "~/features/billing/billing.service";

/**
 * Saves a client. Saving can reprice their sessions (new fees) and match or
 * unmatch sessions (their names): what that brings on is asked first
 * (clients.impact), and new fees list what they reprice (billing.feeImpact).
 * Anything she must confirm waits in `feeImpact` (new fees) or `impact`
 * (anything else) until she confirms or cancels; the API refuses the save
 * unconfirmed.
 */
export function useSaveClient(client: Client | undefined, onSaved: (saved: Client) => void) {
  const save = ClientsMutation.useSave();
  const [pending, setPending] = useState<{ input: SaveClientInput; fees: FeeImpact | null; impact: Impact } | null>(null);
  const [refused, setRefused] = useState<string | null>(null);

  const commit = async (input: SaveClientInput, repriced: number, confirm: boolean) => {
    try {
      const saved = await save.mutateAsync({ input, confirm });
      const note = repriced > 0 ? ` · ${repriced} ${repriced === 1 ? "session" : "sessions"} repriced` : "";
      toast.success(`${client ? "Client updated" : "Client added"}${note}`);
      onSaved(saved);
    } catch {
      // Shown through error.
    } finally {
      setPending(null);
    }
  };

  const submit = async (input: SaveClientInput) => {
    setRefused(null);
    let fees: FeeImpact | null = null;
    let impact: Impact | null = null;
    try {
      if (client && feesChanged(client, input.feeRates ?? [])) {
        fees = await BillingService.feeImpact({ clientId: client.id, feeRates: input.feeRates ?? [] });
      }
      impact = await ClientsService.impact(input);
    } catch {
      // Saving reports the same problem through error.
    }
    if (impact?.refused) return setRefused(impact.refused);
    if (impact && (impact.needsConfirm || fees?.needsConfirm)) return setPending({ input, fees, impact });
    await commit(input, fees?.changes.length ?? 0, false);
  };

  const showFees = pending !== null && pending.fees?.needsConfirm === true;
  return {
    submit,
    /** New fees waiting for her to confirm what they reprice. */
    feeImpact: showFees ? pending.fees : null,
    /** Anything else saving brings on, waiting for her to confirm. */
    impact: pending && !showFees ? pending.impact : null,
    confirm: () => pending && void commit(pending.input, pending.fees?.changes.length ?? 0, true),
    cancel: () => setPending(null),
    isSaving: save.isPending,
    error: save.error ?? (refused ? new Error(refused) : null),
  };
}
