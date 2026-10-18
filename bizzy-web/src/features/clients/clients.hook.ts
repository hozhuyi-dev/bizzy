import { toast } from "sonner";
import { feesChanged } from "./clients.form";
import { ClientsMutation } from "./clients.mutation";
import type { ClientFields, ClientView } from "./clients.types";

/**
 * Saves a client: a new one, or what changed on `client`. New fees reach
 * the sessions not invoiced or paid yet; those already invoiced or paid
 * keep the fee they were charged. A new calendar name can let an edit
 * waiting in the calendar apply.
 */
export function useSaveClient(client: ClientView | undefined, onSaved: (saved: ClientView) => void) {
  const create = ClientsMutation.useCreate();
  const update = ClientsMutation.useUpdate();
  const save = client ? update : create;

  const submit = async (fields: ClientFields) => {
    try {
      const saved = client ? await update.mutateAsync({ id: client.id, fields }) : await create.mutateAsync(fields);
      const repriced = client && fields.feeRates && feesChanged(client, fields.feeRates);
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
