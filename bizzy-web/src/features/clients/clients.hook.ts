import { useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { isLapsed } from "./client-activity.util";
import { feesChanged } from "./clients.form";
import { ClientsMutation } from "./clients.mutation";
import { ClientsQuery } from "./clients.query";
import { clientsListLink, lapseOf, toClientRow } from "./clients.util";
import type { ClientFields, ClientRow, ClientView } from "./clients.types";
import type { ListFilter } from "~/core/list/filter.types";
import { ActivityQuery } from "~/features/activity/activity.query";
import { toastWithQuip } from "~/components/shared/quip/quip-toast";
import { QUIPS } from "~/core/constants/quips.constant";

/**
 * Saves a client: a new one, or what changed on `client`. New fees reach
 * the sessions not invoiced or paid yet; those already invoiced or paid
 * keep the fee they were charged. A new calendar name can let an edit
 * waiting in the calendar apply. Resolves to the saved client, or undefined
 * when refused. `onSaved` gets what the toast says; `quiet` leaves the
 * toast to it, to say with more.
 */
export function useSaveClient(
  client: ClientView | undefined,
  onSaved: (saved: ClientView, done: string) => void,
  { quiet = false }: { quiet?: boolean } = {},
) {
  const create = ClientsMutation.useCreate();
  const update = ClientsMutation.useUpdate();
  const save = client ? update : create;

  const submit = async (fields: ClientFields) => {
    try {
      const saved = client ? await update.mutateAsync({ id: client.id, fields }) : await create.mutateAsync(fields);
      const repriced = client && fields.feeRates && feesChanged(client, fields.feeRates);
      const done = client ? `${saved.name} updated` : `${saved.name} added`;
      // New fees are money, and the toast says what they reach: no quip then.
      if (quiet) {
        // The caller says it, with more.
      } else if (repriced) toast.success(`${done} · new fees apply to sessions not invoiced or paid yet`);
      else toastWithQuip(done, QUIPS.saved);
      onSaved(saved, done);
      return saved;
    } catch {
      // Shown through error.
      return undefined;
    }
  };

  return { submit, isSaving: save.isPending, error: save.error };
}

/**
 * Goes where a clients filter is: Reconnect with a Last session chip (so
 * the nav shows it), All clients without. Typing replaces the entry.
 */
export function useClientsNavigate(filter: ListFilter): (next: ListFilter) => void {
  const navigate = useNavigate();
  return (next) => void navigate({ ...clientsListLink(next), replace: next.text !== filter.text });
}

/**
 * The clients a filter's Last session chip keeps, with their activity:
 * every client without one. The words are searched by the table.
 */
export function useClientRows(filter: ListFilter): Array<ClientRow> {
  const clients = ClientsQuery.useList();
  const activityByClient = ActivityQuery.useByClient();
  const lapse = lapseOf(filter);
  return useMemo(() => {
    const now = new Date();
    const all = (clients.data ?? []).map((client) => toClientRow(client, activityByClient.get(client.id), now));
    return lapse ? all.filter((row) => isLapsed(row.client, row.activity, Number(lapse), now)) : all;
  }, [clients.data, activityByClient, lapse]);
}
