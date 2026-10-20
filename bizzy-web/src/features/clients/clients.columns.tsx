import { BellIcon, CheckIcon, MessageCircleIcon } from "lucide-react";
import { contactProblem, extraAliases } from "./clients.util";
import type { LinkOptions } from "@tanstack/react-router";
import type { ClientRow, ClientView } from "./clients.types";
import type { Action } from "~/components/shared/action-bar/action-bar.component";
import type { RowActionSet } from "~/components/shared/row-actions/row-actions.component";
import { whatsappNumber } from "~/features/whatsapp/whatsapp.util";
import { Badge } from "~/components/ui/badge";
import { CellEmpty, CellText, RowLink } from "~/components/shared/data-table/data-table-cell.component";
import { createDataTableColumnHelper } from "~/components/shared/data-table/data-table.config";
import { DataCard } from "~/components/shared/data-card/data-card.component";
import { RowActionButtons } from "~/components/shared/row-actions/row-actions.component";
import { formatCents } from "~/core/utils/money.util";
import { formatDate } from "~/core/utils/date.util";

const helper = createDataTableColumnHelper<ClientRow>();

/** "3 mo ago · Booked 12 Nov 2026": how long since, and the next session booked. */
function sinceText(row: ClientRow): string | undefined {
  const parts = [
    row.monthsSince !== undefined && row.monthsSince > 0 ? `${row.monthsSince} mo ago` : undefined,
    row.activity?.nextBookedAt ? `Booked ${formatDate(row.activity.nextBookedAt)}` : undefined,
  ];
  return parts.filter(Boolean).join(" · ") || undefined;
}

/** When the client was last seen, how long ago, and the next session booked; for the client's page. */
export function LastSeen({ row }: { row: ClientRow }) {
  if (!row.lastSessionAt) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="flex flex-wrap items-center gap-1">
      {formatDate(row.lastSessionAt)}
      {row.monthsSince !== undefined && row.monthsSince > 0 && (
        <span className="text-muted-foreground">· {row.monthsSince} mo ago</span>
      )}
      {row.activity?.nextBookedAt && <Badge variant="info">Booked {formatDate(row.activity.nextBookedAt)}</Badge>}
    </span>
  );
}

/** Under the name: what is wrong with the contact, else the client's other calendar names. */
function ClientNote({ client }: { client: ClientView }) {
  const problem = contactProblem(client);
  if (problem) return <span className="text-status-attention-foreground">{problem}</span>;
  const aliases = extraAliases(client);
  return aliases.length > 0 ? `Also ${aliases.join(", ")}` : undefined;
}

export function clientLink(client: ClientView): LinkOptions {
  return { to: "/clients/$id", params: { id: client.id } };
}

function ClientLink({ client }: { client: ClientView }) {
  return <RowLink {...clientLink(client)}>{client.name}</RowLink>;
}

interface ClientActions {
  /** Opens the client's chat; offered when their phone can take one. */
  onWhatsApp?: (client: ClientView) => void;
  onContacted?: (client: ClientView) => void;
  /** Makes a follow-up to get back to them on a day. */
  onRemind?: (client: ClientView) => void;
}

/** The client's name links to their page, so editing needs no action here. */
export function clientActions(client: ClientView, { onWhatsApp, onContacted, onRemind }: ClientActions): RowActionSet {
  const set = { actions: [] as Array<Action>, more: [] as Array<Action> };
  if (onWhatsApp && whatsappNumber(client.contact?.phone)) {
    set.actions.push({ type: "button", label: "WhatsApp", icon: MessageCircleIcon, onClick: () => onWhatsApp(client) });
  }
  if (onContacted) set.actions.push({ type: "button", label: "Contacted", icon: CheckIcon, onClick: () => onContacted(client) });
  if (onRemind) set.more.push({ type: "button", label: "Remind me", icon: BellIcon, onClick: () => onRemind(client) });
  return set;
}

/** The phone layout of a table row: the same fields and actions. */
export function ClientCard({ row, ...handlers }: { row: ClientRow } & ClientActions) {
  const { client } = row;
  const problem = contactProblem(client);
  const since = sinceText(row);
  return (
    <DataCard
      title={
        <>
          <span className="font-medium">{client.name}</span>
          {problem && <Badge variant="attention">{problem}</Badge>}
        </>
      }
      value={client.feeTodayCents === undefined ? undefined : `${formatCents(client.feeTodayCents)}/h`}
      meta={
        row.lastSessionAt
          ? `Last session ${formatDate(row.lastSessionAt)}${since ? ` · ${since}` : ""}`
          : "No sessions yet"
      }
      detail={`${formatCents(row.revenue12Cents)} in 12 months (${row.sessions12}×) · ${formatCents(row.lifetimeCents)} in all`}
      {...clientActions(client, handlers)}
      open={clientLink(client)}
    />
  );
}

export function createClientColumns(handlers: ClientActions) {
  return helper.columns([
    helper.accessor((row) => row.client.name, {
      id: "name",
      header: "Name",
      sortFn: "alphanumeric",
      meta: {
        width: "grow",
        search: ({ client }: ClientRow) => [client.name, ...client.aliases, contactProblem(client)],
      },
      cell: ({ row }) => (
        <CellText sub={<ClientNote client={row.original.client} />}>
          <ClientLink client={row.original.client} />
        </CellText>
      ),
    }),
    helper.accessor((row) => row.client.contact?.phone ?? row.client.contact?.email ?? "", {
      id: "contact",
      header: "Contact",
      sortFn: "alphanumeric",
      meta: {
        from: "lg",
        search: ({ client }: ClientRow) => [client.contact?.phone, client.contact?.email],
      },
      cell: ({ row }) => {
        const { contact } = row.original.client;
        if (!contact?.phone && !contact?.email) return <CellEmpty />;
        return (
          <CellText className="max-w-56" sub={contact.phone ? contact.email : undefined}>
            {contact.phone ?? contact.email}
          </CellText>
        );
      },
    }),
    helper.accessor("lastSessionAt", {
      header: "Last session",
      sortFn: "alphanumeric",
      meta: {
        search: (row: ClientRow) => [
          row.lastSessionAt && formatDate(row.lastSessionAt),
          row.activity?.nextBookedAt && `Booked ${formatDate(row.activity.nextBookedAt)}`,
        ],
      },
      sortUndefined: "last",
      cell: ({ row }) =>
        row.original.lastSessionAt ? (
          <CellText sub={sinceText(row.original)}>{formatDate(row.original.lastSessionAt)}</CellText>
        ) : (
          <CellEmpty />
        ),
    }),
    helper.accessor("revenue12Cents", {
      header: "Last 12 months",
      sortFn: "basic",
      meta: { align: "end", search: (row: ClientRow) => formatCents(row.revenue12Cents) },
      cell: ({ row }) => (
        <CellText sub={`${row.original.sessions12} ${row.original.sessions12 === 1 ? "session" : "sessions"}`}>
          {formatCents(row.original.revenue12Cents)}
        </CellText>
      ),
    }),
    helper.accessor("lifetimeCents", {
      header: "Lifetime",
      sortFn: "basic",
      meta: { align: "end", search: (row: ClientRow) => formatCents(row.lifetimeCents) },
      cell: ({ getValue }) => formatCents(getValue()),
    }),
    helper.accessor((row) => row.client.feeTodayCents, {
      id: "fee",
      header: "Hourly fee",
      sortFn: "basic",
      meta: {
        align: "end",
        search: ({ client }: ClientRow) => [
          client.feeTodayCents === undefined ? undefined : formatCents(client.feeTodayCents),
          client.homeVisits ? "Home visits" : undefined,
        ],
      },
      sortUndefined: "last",
      cell: ({ row }) => {
        const { client } = row.original;
        if (client.feeTodayCents === undefined) return <CellEmpty />;
        return <CellText sub={client.homeVisits ? "Home visits" : undefined}>{formatCents(client.feeTodayCents)}</CellText>;
      },
    }),
    helper.display({
      id: "actions",
      header: () => <span className="sr-only">Actions</span>,
      meta: { width: "fit" },
      cell: ({ row }) => <RowActionButtons {...clientActions(row.original.client, handlers)} />,
    }),
  ]);
}
