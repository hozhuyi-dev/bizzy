import { toast } from "sonner";
import { feesChanged } from "./clients.form";
import { ClientsMutation } from "./clients.mutation";
import type { Client, SaveClientInput } from "./clients.types";

/**
 * Saves a client. New fees reach the sessions not invoiced or paid yet;
 * those already invoiced or paid keep the fee they were charged. A new
 * calendar name can let an edit waiting in the calendar apply.
 */
export function useSaveClient(client: Client | undefined, onSaved: (saved: Client) => void) {
  const save = ClientsMutation.useSave();

  const submit = async (input: SaveClientInput) => {
    try {
      const saved = await save.mutateAsync(input);
      const repriced = client && feesChanged(client, input.feeRates ?? []);
      toast.success(
        `${client ? "Client updated" : "Client added"}${repriced ? " · new fees apply to sessions not invoiced or paid yet" : ""}`,
      );
      onSaved(saved);
    } catch {
      // Shown through error.
    }
  };

  return { submit, isSaving: save.isPending, error: save.error };
}
