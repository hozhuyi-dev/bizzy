import { BellIcon, CheckIcon, MessageCircleIcon } from "lucide-react";
import { contactProblem, extraAliases } from "./clients.util";
import type { LinkOptions } from "@tanstack/react-router";
import type { ClientNext, ClientRow, ClientView, ClientsFilter, ClientsListSearch } from "./clients.types";
import type { Action } from "~/components/shared/action-bar/action-bar.component";
import type { RowActionSet } from "~/components/shared/row-actions/row-actions.component";
import { whatsappNumber } from "~/features/whatsapp/whatsapp.util";
import { Badge } from "~/components/ui/badge";
import { CellEmpty, CellText, RowLink } from "~/components/shared/data-table/data-table-cell.component";
import { createDataTableColumnHelper } from "~/components/shared/data-table/data-table.config";
import { DataCard } from "~/components/shared/data-card/data-card.component";
import { RowActionButtons } from "~/components/shared/row-actions/row-actions.component";
import { formatCents } from "~/core/utils/money.util";
import { formatDate, formatHours } from "~/core/utils/date.util";

const helper = createDataTableColumnHelper<ClientRow>();

/** "3 mo ago": how long since the last session. */
function sinceText(row: ClientRow): string | undefined {
  return row.monthsSince !== undefined && row.monthsSince > 0 ? `${row.monthsSince} mo ago` : undefined;
}

/** "Booked 12 Nov", "Follow-up 3 Nov": what is next with them. */
function nextText(next: ClientNext): string {
  return `${next.kind === "session" ? "Booked" : "Follow-up"} ${formatDate(next.at)}`;
}

/** A follow-up due already: it is waiting on her. */
function overdue(next: ClientNext, now = new Date()): boolean {
  return next.kind === "followUp" && new Date(next.at) < now;
}

/** "2 h left": what their packages have left. */
function creditsText(row: ClientRow): string | undefined {
  return row.creditsLeftMinutes > 0 ? `${formatHours(row.creditsLeftMinutes / 60)} left` : undefined;
}

/**
 * Under the name: what is wrong with the contact, else what they are
 * being seen for lately (the last summary), else their other calendar
 * names.
 */
function ClientNote({ row }: { row: ClientRow }) {
  const { client } = row;
  const problem = contactProblem(client);
  if (problem) return <span className="text-status-attention-foreground">{problem}</span>;
  if (row.activity?.lastSummary) return row.activity.lastSummary;
  const aliases = extraAliases(client);
  return aliases.length > 0 ? `Also ${aliases.join(", ")}` : undefined;
}

/** Sessions that happened with nothing written yet. */
function UnrecordedBadge({ row }: { row: ClientRow }) {
  const n = row.activity?.unrecorded ?? 0;
  return n > 0 ? <Badge variant="neutral">{n} to record</Badge> : null;
}

/** The client's page, with the list it steps through. */
export function clientLink(id: string, search?: ClientsListSearch): LinkOptions {
  return { to: "/clients/$id", params: { id }, search: search ?? {} };
}

function ClientLink({ client, search }: { client: ClientView; search: ClientsListSearch | undefined }) {
  return <RowLink {...clientLink(client.id, search)}>{client.name}</RowLink>;
}

/** How a view sorts until she picks a column: lapsed clients are worked through most valuable first. */
export function clientSorting(view: ClientsFilter) {
  return view === "reconnect" ? [{ id: "lifetimeCents", desc: true }] : [{ id: "name", desc: false }];
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

interface ClientCardProps extends ClientActions {
  view: ClientsFilter;
  row: ClientRow;
  search?: ClientsListSearch | undefined;
}

/** The phone layout of a table row: the same fields and actions. */
export function ClientCard({ view, row, search, ...handlers }: ClientCardProps) {
  const { client } = row;
  const problem = contactProblem(client);
  const last = row.lastSessionAt ? `Last session ${formatDate(row.lastSessionAt)}` : "No sessions yet";
  const meta =
    view === "reconnect"
      ? [last, row.lastContactedAt && `contacted ${formatDate(row.lastContactedAt)}`]
      : [last, row.next && nextText(row.next), creditsText(row)];
  return (
    <DataCard
      title={
        <>
          <span className="font-medium">{client.name}</span>
          {problem && <Badge variant="attention">{problem}</Badge>}
          <UnrecordedBadge row={row} />
        </>
      }
      value={
        view === "reconnect"
          ? formatCents(row.lifetimeCents)
          : row.owedCents > 0
            ? `${formatCents(row.owedCents)} owed`
            : undefined
      }
      meta={meta.filter(Boolean).join(" · ")}
      detail={row.activity?.lastSummary}
      {...clientActions(client, handlers)}
      open={clientLink(client.id, search)}
    />
  );
}

/**
 * The table's columns for a view; `search` is the list's filter, for each
 * client's page to step through. All clients is where each one stands;
 * Reconnect, who is worth getting back in touch with.
 */
export function createClientColumns(view: ClientsFilter, handlers: ClientActions, search?: ClientsListSearch) {
  const name = helper.accessor((row) => row.client.name, {
    id: "name",
    header: "Name",
    sortFn: "alphanumeric",
    meta: {
      width: "grow",
      search: ({ client, activity }: ClientRow) => [
        client.name,
        ...client.aliases,
        contactProblem(client),
        client.contact?.phone,
        client.contact?.email,
        activity?.lastSummary,
      ],
    },
    cell: ({ row }) => (
      <CellText sub={<ClientNote row={row.original} />} title={row.original.activity?.lastSummary}>
        <span className="flex min-w-0 items-center gap-2">
          <ClientLink client={row.original.client} search={search} />
          <UnrecordedBadge row={row.original} />
        </span>
      </CellText>
    ),
  });
  const lastSession = helper.accessor("lastSessionAt", {
    header: "Last session",
    sortFn: "alphanumeric",
    meta: { search: (row: ClientRow) => row.lastSessionAt && formatDate(row.lastSessionAt) },
    sortUndefined: "last",
    cell: ({ row }) =>
      row.original.lastSessionAt ? (
        <CellText sub={sinceText(row.original)}>{formatDate(row.original.lastSessionAt)}</CellText>
      ) : (
        <CellEmpty />
      ),
  });
  const actions = helper.display({
    id: "actions",
    header: () => <span className="sr-only">Actions</span>,
    meta: { width: "fit" },
    cell: ({ row }) => <RowActionButtons {...clientActions(row.original.client, handlers)} />,
  });

  if (view === "reconnect") {
    return helper.columns([
      name,
      lastSession,
      helper.accessor("lastContactedAt", {
        header: "Last contacted",
        sortFn: "alphanumeric",
        meta: { search: (row: ClientRow) => row.lastContactedAt && formatDate(row.lastContactedAt) },
        sortUndefined: "last",
        cell: ({ getValue }) => {
          const at = getValue();
          return at ? formatDate(at) : <CellEmpty />;
        },
      }),
      helper.accessor("lifetimeCents", {
        header: "Lifetime",
        sortFn: "basic",
        meta: { align: "end", search: (row: ClientRow) => formatCents(row.lifetimeCents) },
        cell: ({ getValue }) => formatCents(getValue()),
      }),
      actions,
    ]);
  }

  return helper.columns([
    name,
    lastSession,
    helper.accessor((row) => row.next?.at, {
      id: "next",
      header: "Next",
      sortFn: "alphanumeric",
      meta: { search: (row: ClientRow) => row.next && nextText(row.next) },
      sortUndefined: "last",
      cell: ({ row }) => {
        const { next } = row.original;
        if (!next) return <CellEmpty />;
        return (
          <CellText sub={next.kind === "session" ? "Booked" : overdue(next) ? "Follow-up, overdue" : "Follow-up"}>
            {formatDate(next.at)}
          </CellText>
        );
      },
    }),
    helper.accessor("owedCents", {
      header: "Owed",
      sortFn: "basic",
      meta: { align: "end", search: (row: ClientRow) => (row.owedCents > 0 ? formatCents(row.owedCents) : undefined) },
      cell: ({ getValue }) => (getValue() > 0 ? formatCents(getValue()) : <CellEmpty />),
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
    helper.accessor("creditsLeftMinutes", {
      header: "Credits",
      sortFn: "basic",
      meta: { align: "end", from: "lg", search: (row: ClientRow) => creditsText(row) },
      cell: ({ row }) => creditsText(row.original) ?? <CellEmpty />,
    }),
    actions,
  ]);
}
