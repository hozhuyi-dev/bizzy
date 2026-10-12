import { BellIcon, CheckIcon, MessageCircleIcon } from "lucide-react";
import { last12Months, monthsSinceLastSession, totals } from "./clients.activity";
import type { Client } from "./clients.types";
import type { RowAction } from "~/components/shared/row-actions/row-actions.component";
import { openWhatsApp, whatsappLink } from "~/features/whatsapp/whatsapp.link";
import { Badge } from "~/components/ui/badge";
import { Card, CardContent } from "~/components/ui/card";
import { createDataTableColumnHelper } from "~/components/shared/data-table/data-table.features";
import { RowActionButtons, RowActionMenu } from "~/components/shared/row-actions/row-actions.component";
import { TextLink } from "~/components/shared/text-link/text-link.component";
import { formatCents } from "~/core/utils/money.util";
import { formatDate } from "~/core/utils/date.util";

/** A client with the figures the table sorts by. */
export interface ClientRow {
  client: Client;
  lastSessionAt: string | undefined;
  monthsSince: number | undefined;
  revenue12Cents: number;
  lifetimeCents: number;
  sessions12: number;
}

export function toClientRow(client: Client, now = new Date()): ClientRow {
  const year = last12Months(client, now);
  return {
    client,
    lastSessionAt: client.lastSessionAt,
    monthsSince: monthsSinceLastSession(client, now),
    revenue12Cents: year.receivedCents,
    lifetimeCents: totals(client).receivedCents,
    sessions12: year.sessions,
  };
}

const helper = createDataTableColumnHelper<ClientRow>();

/** Aliases other than the client's own name, which is always one of them. */
export function extraAliases(client: Client): Array<string> {
  const name = client.name.toLowerCase();
  return client.aliases.filter((alias) => alias !== name);
}

export function LastSeen({ row }: { row: ClientRow }) {
  if (!row.lastSessionAt) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="flex flex-wrap items-center gap-1">
      {formatDate(row.lastSessionAt)}
      {row.monthsSince !== undefined && row.monthsSince > 0 && (
        <span className="text-muted-foreground">· {row.monthsSince} mo ago</span>
      )}
      {row.client.nextBookedAt && (
        <Badge variant="info">Booked {formatDate(row.client.nextBookedAt)}</Badge>
      )}
    </span>
  );
}

interface ClientActions {
  onContacted?: (client: Client) => void;
  /** Makes a follow-up to get back to them on a day. */
  onRemind?: (client: Client) => void;
}

/** The client's name links to their page, so editing needs no action here. */
export function clientActions(client: Client, { onContacted, onRemind }: ClientActions): Array<RowAction> {
  const actions: Array<RowAction> = [];
  const whatsapp = whatsappLink(client.contact?.phone);
  if (whatsapp) actions.push({ label: "WhatsApp", icon: MessageCircleIcon, onClick: () => openWhatsApp(whatsapp) });
  if (onContacted) actions.push({ label: "Contacted", icon: CheckIcon, onClick: () => onContacted(client) });
  if (onRemind) actions.push({ label: "Remind me", icon: BellIcon, onClick: () => onRemind(client) });
  return actions;
}

/** Says when the client's Google contact needs her attention. */
export function contactProblem(client: Client): string | undefined {
  if (!client.contact) return "No contact";
  if (client.contact.missing) return "Contact deleted in Google";
  return undefined;
}

/** The name with her other calendar names under it. */
export function ClientName({ client }: { client: Client }) {
  const aliases = extraAliases(client);
  const problem = contactProblem(client);
  return (
    <div className="flex flex-col gap-1">
      <TextLink to="/clients/$id" params={{ id: client.id }} className="w-fit">
        {client.name}
      </TextLink>
      {(aliases.length > 0 || problem) && (
        <div className="flex flex-wrap gap-1">
          {problem && <Badge variant="attention">{problem}</Badge>}
          {aliases.map((alias) => (
            <Badge key={alias} variant="neutral">
              {alias}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

/** The phone layout of a table row: the same fields and actions. */
export function ClientCard({ row, ...handlers }: { row: ClientRow } & ClientActions) {
  const { client } = row;
  return (
    <Card size="sm">
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-2">
          <ClientName client={client} />
          <RowActionMenu actions={clientActions(client, handlers)} />
        </div>
        <div className="text-sm">
          <span className="text-xs text-muted-foreground">Last session</span>
          <LastSeen row={row} />
        </div>
        <dl className="grid grid-cols-3 gap-2 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">Last 12 months</dt>
            <dd>
              {formatCents(row.revenue12Cents)}
              <span className="text-muted-foreground"> · {row.sessions12}×</span>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Lifetime</dt>
            <dd>{formatCents(row.lifetimeCents)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Default fee</dt>
            <dd>{client.defaultFeeCents === undefined ? "—" : formatCents(client.defaultFeeCents)}</dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}

export function createClientColumns(handlers: ClientActions) {
  return helper.columns([
    helper.accessor((row) => row.client.name, {
      id: "name",
      header: "Name",
      sortFn: "alphanumeric",
      meta: {
        search: ({ client }: ClientRow) => [
          client.name,
          ...client.aliases,
          client.contact?.phone,
          client.contact?.email,
          contactProblem(client),
        ],
      },
      cell: ({ row }) => <ClientName client={row.original.client} />,
    }),
    helper.accessor("lastSessionAt", {
      header: "Last session",
      sortFn: "alphanumeric",
      meta: {
        search: (row: ClientRow) => [
          row.lastSessionAt && formatDate(row.lastSessionAt),
          row.client.nextBookedAt && `Booked ${formatDate(row.client.nextBookedAt)}`,
        ],
      },
      sortUndefined: "last",
      cell: ({ row }) => <LastSeen row={row.original} />,
    }),
    helper.accessor("revenue12Cents", {
      header: "Last 12 months",
      sortFn: "basic",
      meta: { search: (row: ClientRow) => formatCents(row.revenue12Cents) },
      cell: ({ row }) => (
        <span>
          {formatCents(row.original.revenue12Cents)}
          <span className="text-muted-foreground"> · {row.original.sessions12}×</span>
        </span>
      ),
    }),
    helper.accessor("lifetimeCents", {
      header: "Lifetime",
      sortFn: "basic",
      meta: { search: (row: ClientRow) => formatCents(row.lifetimeCents) },
      cell: ({ getValue }) => formatCents(getValue()),
    }),
    helper.accessor((row) => row.client.defaultFeeCents, {
      id: "defaultFee",
      header: "Default fee",
      sortFn: "basic",
      meta: {
        search: ({ client }: ClientRow) =>
          client.defaultFeeCents === undefined ? undefined : formatCents(client.defaultFeeCents),
      },
      sortUndefined: "last",
      cell: ({ getValue }) => {
        const cents = getValue();
        return cents === undefined ? "—" : formatCents(cents);
      },
    }),
    helper.display({
      id: "actions",
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row }) => <RowActionButtons actions={clientActions(row.original.client, handlers)} />,
    }),
  ]);
}
