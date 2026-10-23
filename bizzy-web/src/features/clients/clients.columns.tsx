import { BellIcon, CheckIcon, MessageCircleIcon } from "lucide-react";
import { contactProblem, extraAliases, isLapsed } from "./clients.util";
import type { LinkOptions } from "@tanstack/react-router";
import type { ClientNext, ClientRow, ClientView, ClientsListSearch } from "./clients.types";
import type { Action } from "~/components/shared/actions/action-bar/action-bar.types";
import type { RowActionSet } from "~/components/shared/actions/row-actions/row-actions.component";
import { whatsappNumber } from "~/features/whatsapp/whatsapp.util";
import { Badge } from "~/components/ui/badge";
import { CellEmpty, CellText } from "~/components/shared/list/data-table/data-table-cell.component";
import { createDataTableColumnHelper } from "~/components/shared/list/data-table/data-table.config";
import { DataCard } from "~/components/shared/list/data-card/data-card.component";
import { RowActions } from "~/components/shared/actions/row-actions/row-actions.component";
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

/** How the list sorts until she picks a column (or a preset sorts it): A to Z. */
export const CLIENT_SORTING = [{ id: "name", desc: false }];

/** "Contacted 3 Oct", when she reached out since their last session. */
function contactedText(row: ClientRow): string | undefined {
  const { lastContactedAt, lastSessionAt } = row;
  if (!lastContactedAt || (lastSessionAt && lastContactedAt < lastSessionAt)) return undefined;
  return `Contacted ${formatDate(lastContactedAt)}`;
}

/** "RM 1,200 · 8 sessions in 12 months": the past year, under what they spent in all. */
function yearText(row: ClientRow): string {
  return `${formatCents(row.revenue12Cents)} · ${row.sessions12} ${row.sessions12 === 1 ? "session" : "sessions"} in 12 months`;
}

export interface ClientActions {
  /** Opens the client's chat; offered when their phone can take one. */
  onWhatsApp?: (client: ClientView) => void;
  onContacted?: (client: ClientView) => void;
  /** Makes a follow-up to get back to them on a day. */
  onRemind?: (client: ClientView) => void;
}

/**
 * WhatsApp; for a client lapsed (see isLapsed), Contacted, and Remind me
 * behind ⋯, wherever the list has them. A click on the row opens them.
 */
export function clientActions(row: ClientRow, { onWhatsApp, onContacted, onRemind }: ClientActions): RowActionSet {
  const { client } = row;
  const set = { actions: [] as Array<Action>, more: [] as Array<Action> };
  if (onWhatsApp && whatsappNumber(client.contact?.phone)) {
    set.actions.push({ type: "button", label: "WhatsApp", icon: MessageCircleIcon, onClick: () => onWhatsApp(client) });
  }
  if (!isLapsed(row)) return set;
  if (onContacted) set.actions.push({ type: "button", label: "Contacted", icon: CheckIcon, onClick: () => onContacted(client) });
  if (onRemind) set.more.push({ type: "button", label: "Remind me", icon: BellIcon, onClick: () => onRemind(client) });
  return set;
}

interface ClientCardProps extends ClientActions {
  row: ClientRow;
  search?: ClientsListSearch | undefined;
}

/** The phone layout of a table row: the same fields and actions. */
export function ClientCard({ row, search, ...handlers }: ClientCardProps) {
  const { client } = row;
  const problem = contactProblem(client);
  const last = row.lastSessionAt ? `Last session ${formatDate(row.lastSessionAt)}` : "No sessions yet";
  const meta = [last, contactedText(row)?.toLowerCase(), row.next && nextText(row.next), creditsText(row)];
  return (
    <DataCard
      title={
        <>
          <span className="font-medium">{client.name}</span>
          {problem && <Badge variant="attention">{problem}</Badge>}
          <UnrecordedBadge row={row} />
        </>
      }
      value={row.owedCents > 0 ? `${formatCents(row.owedCents)} owed` : formatCents(row.lifetimeCents)}
      meta={meta.filter(Boolean).join(" · ")}
      detail={row.activity?.lastSummary}
      {...clientActions(row, handlers)}
      open={clientLink(client.id, search)}
    />
  );
}

/**
 * The table's columns, one set whatever the filter: where each client
 * stands, what they spent, and when she last saw or reached them. `search`
 * is the list's filter, for each client's page to step through.
 */
export function createClientColumns(handlers: ClientActions, search?: ClientsListSearch) {
  return helper.columns([
    helper.accessor((row) => row.client.name, {
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
            <span className="truncate font-medium">{row.original.client.name}</span>
            <UnrecordedBadge row={row.original} />
          </span>
        </CellText>
      ),
    }),
    helper.accessor("lastSessionAt", {
      header: "Last session",
      sortFn: "basic",
      meta: { search: (row: ClientRow) => [row.lastSessionAt && formatDate(row.lastSessionAt), contactedText(row)] },
      sortUndefined: "last",
      cell: ({ row }) =>
        row.original.lastSessionAt ? (
          <CellText sub={contactedText(row.original) ?? sinceText(row.original)}>{formatDate(row.original.lastSessionAt)}</CellText>
        ) : (
          <CellEmpty />
        ),
    }),
    helper.accessor((row) => row.next?.at, {
      id: "next",
      header: "Next",
      sortFn: "basic",
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
    helper.accessor("creditsLeftMinutes", {
      header: "Credits",
      sortFn: "basic",
      meta: { align: "end", from: "lg", search: (row: ClientRow) => creditsText(row) },
      cell: ({ row }) => creditsText(row.original) ?? <CellEmpty />,
    }),
    helper.accessor("lifetimeCents", {
      header: "Spent",
      sortFn: "basic",
      meta: { align: "end", search: (row: ClientRow) => formatCents(row.lifetimeCents) },
      cell: ({ row }) => <CellText sub={yearText(row.original)}>{formatCents(row.original.lifetimeCents)}</CellText>,
    }),
    helper.display({
      id: "actions",
      header: () => <span className="sr-only">Actions</span>,
      meta: { width: "fit" },
      cell: ({ row }) => <RowActions {...clientActions(row.original, handlers)} />,
    }),
  ]);
}
