import { useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { ClientsMutation } from "./clients.mutation";
import { ClientsQuery } from "./clients.query";
import { clientsListLink, matchesChips, toClientRow } from "./clients.util";
import type { ClientFields, ClientRow, ClientView } from "./clients.types";
import type { ListFilter } from "~/core/list/filter.types";
import { ActivityQuery } from "~/features/activity/activity.query";
import { toastWithQuip } from "~/components/shared/feedback/quip/quip.util";
import { QUIPS } from "~/core/constants/quips.constant";

/**
 * Saves a client: a new one, or what changed on `client`. A new fee is
 * charged on sessions booked from then; those booked already keep the fee
 * they were charged. A new calendar name can let an edit
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
      const newFee = client && fields.fee;
      const done = client ? `${saved.name} updated` : `${saved.name} added`;
      // A new fee is money, and the toast says what it reaches: no quip then.
      if (quiet) {
        // The caller says it, with more.
      } else if (newFee) toast.success(`${done} · sessions booked already keep their fee`);
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

/** Goes where a clients filter is; typing replaces the entry. */
export function useClientsNavigate(filter: ListFilter): (next: ListFilter) => void {
  const navigate = useNavigate();
  return (next) => void navigate({ ...clientsListLink(next), replace: next.text !== filter.text });
}

/**
 * The clients a filter's chips keep, with their activity: lapsed that
 * long, booked, owing and so on, as the API says each one stands. The
 * words are searched by the table.
 */
export function useClientRows(filter: ListFilter): Array<ClientRow> {
  const clients = ClientsQuery.useList();
  const activityByClient = ActivityQuery.useByClient();
  // Routes make a new filter each render: the chips, as text, say when it changed.
  const chips = JSON.stringify(filter.chips);
  return useMemo(() => {
    const now = new Date();
    const kept: ListFilter["chips"] = JSON.parse(chips);
    return (clients.data ?? [])
      .map((client) => toClientRow(client, activityByClient.get(client.id), now))
      .filter((row) => matchesChips(row, kept));
  }, [clients.data, activityByClient, chips]);
}
