import { BellIcon, CheckIcon, MessageCircleIcon } from "lucide-react";
import { contactProblem, extraAliases } from "./clients.util";
import type { Client, ClientRow } from "./clients.types";
import type { RowAction } from "~/components/shared/row-actions/row-actions.component";
import { whatsappNumber } from "~/features/whatsapp/whatsapp.util";
import { Badge } from "~/components/ui/badge";
import { Card, CardContent } from "~/components/ui/card";
import { createDataTableColumnHelper } from "~/components/shared/data-table/data-table.config";
import { RowActionButtons, RowActionMenu } from "~/components/shared/row-actions/row-actions.component";
import { TextLink } from "~/components/shared/text-link/text-link.component";
import { formatCents } from "~/core/utils/money.util";
import { formatDate } from "~/core/utils/date.util";

const helper = createDataTableColumnHelper<ClientRow>();

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
  /** Opens the client's chat; offered when their phone can take one. */
  onWhatsApp?: (client: Client) => void;
  onContacted?: (client: Client) => void;
  /** Makes a follow-up to get back to them on a day. */
  onRemind?: (client: Client) => void;
}

/** The client's name links to their page, so editing needs no action here. */
export function clientActions(client: Client, { onWhatsApp, onContacted, onRemind }: ClientActions): Array<RowAction> {
  const actions: Array<RowAction> = [];
  if (onWhatsApp && whatsappNumber(client.contact?.phone)) {
    actions.push({ label: "WhatsApp", icon: MessageCircleIcon, onClick: () => onWhatsApp(client) });
  }
  if (onContacted) actions.push({ label: "Contacted", icon: CheckIcon, onClick: () => onContacted(client) });
  if (onRemind) actions.push({ label: "Remind me", icon: BellIcon, onClick: () => onRemind(client) });
  return actions;
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
            <dt className="text-xs text-muted-foreground">Fee</dt>
            <dd>{client.feeTodayCents === undefined ? "—" : formatCents(client.feeTodayCents)}</dd>
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
    helper.accessor((row) => row.client.feeTodayCents, {
      id: "fee",
      header: "Fee",
      sortFn: "basic",
      meta: {
        search: ({ client }: ClientRow) =>
          client.feeTodayCents === undefined ? undefined : formatCents(client.feeTodayCents),
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
