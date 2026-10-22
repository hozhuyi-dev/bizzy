import { useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { feesChanged } from "./clients.form";
import { ClientsMutation } from "./clients.mutation";
import { ClientsQuery } from "./clients.query";
import { clientsListLink, matchesChips, toClientRow, withLapse } from "./clients.util";
import type { ClientFields, ClientRow, ClientView, ClientsFilter } from "./clients.types";
import type { ListFilter } from "~/core/list/filter.types";
import { ActivityQuery } from "~/features/activity/activity.query";
import { toastWithQuip } from "~/components/shared/feedback/quip/quip.util";
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
 * Goes where a view's filter is: Reconnect keeps a lapse (taking its chip
 * off goes back to the shortest), All clients its chips. Typing replaces
 * the entry.
 */
export function useClientsNavigate(view: ClientsFilter, filter: ListFilter): (next: ListFilter) => void {
  const navigate = useNavigate();
  return (next) =>
    void navigate({
      ...clientsListLink(view === "reconnect" ? withLapse(next) : next),
      replace: next.text !== filter.text,
    });
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
