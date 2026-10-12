import {
  BanknoteIcon,
  EyeIcon,
  EyeOffIcon,
  HomeIcon,
  LinkIcon,
  ReceiptIcon,
} from "lucide-react";
import { SESSION_STATUS, receiptSources, sessionAmount, sessionReceipts } from "./session-status";
import type { ReactNode } from "react";
import type { Session } from "./sessions.types";
import type { Client } from "~/features/clients/clients.types";
import type { DocumentSource } from "~/features/documents/documents.types";
import type { Package } from "~/features/packages/packages.types";
import type { RowAction } from "~/components/shared/row-actions/row-actions.component";
import { Badge } from "~/components/ui/badge";
import { createDataTableColumnHelper } from "~/components/shared/data-table/data-table.features";
import { RowActionButtons } from "~/components/shared/row-actions/row-actions.component";
import { TextLink } from "~/components/shared/text-link/text-link.component";
import { formatCents } from "~/core/utils/money.util";
import { formatSessionTime } from "~/core/utils/date.util";

export interface SessionHandlers {
  clientsById: ReadonlyMap<string, Client>;
  /** Packages by ID; one bought in a session's title has the session's ID. */
  packagesById: ReadonlyMap<string, Package>;
  onLink: (session: Session) => void;
  onEditClient: (client: Client) => void;
  onIgnore: (session: Session, ignored: boolean) => void;
  onReceipt: (sources: Array<DocumentSource>) => void;
}

const helper = createDataTableColumnHelper<Session>();

export function SessionWho({ session, clientsById }: { session: Session; clientsById: ReadonlyMap<string, Client> }) {
  const client = session.clientId ? clientsById.get(session.clientId) : undefined;
  return (
    <div className="flex flex-col">
      <span className={client ? "font-medium" : "font-medium text-muted-foreground italic"}>
        {client?.name ?? (session.name || session.title)}
      </span>
      <span className="text-xs text-muted-foreground">{session.title}</span>
    </div>
  );
}

export function SessionStatusCell({ session }: { session: Session }) {
  const status = SESSION_STATUS[session.status];
  // The badge says enough for these; sessions synced earlier still carry a reason.
  const quiet = session.status === "priced" || session.status === "package" || session.status === "tentative";
  const note = session.drift ?? (quiet ? undefined : (session.reason ?? status.hint));
  return (
    <div className="flex flex-col items-start gap-1">
      <div className="flex flex-wrap gap-1">
        <Badge variant={status.variant}>{status.label}</Badge>
        {session.drift && <Badge variant="attention">Changed after receipt</Badge>}
      </div>
      {note && <span className="max-w-64 text-xs text-muted-foreground">{note}</span>}
    </div>
  );
}

export function SessionAmount({ session }: { session: Session }) {
  const amount = sessionAmount(session);
  return (
    <span className="inline-flex items-center gap-1">
      {amount === undefined ? "—" : formatCents(amount)}
      {session.location === "home" && <HomeIcon className="size-3.5 text-muted-foreground" aria-label="Home visit" />}
    </span>
  );
}

/**
 * The receipts covering the session and the package its title bought; making
 * a missing one is an action.
 */
export function SessionReceipt({
  session,
  handlers,
  empty = "—",
}: {
  session: Session;
  handlers: SessionHandlers;
  /** Shown when there is no receipt yet. */
  empty?: ReactNode;
}) {
  const receipts = sessionReceipts(session, handlers.packagesById.get(session.eventId));
  if (receipts.length === 0) return empty;

  return (
    <span className="flex flex-wrap items-center gap-2">
      {receipts.map((ref) => (
        <TextLink key={ref.documentId} to="/receipts/$id" params={{ id: ref.documentId }} className="text-sm">
          {ref.number ?? "Draft"}
        </TextLink>
      ))}
    </span>
  );
}

export function sessionActions(session: Session, handlers: SessionHandlers): Array<RowAction> {
  const client = session.clientId ? handlers.clientsById.get(session.clientId) : undefined;
  const actions: Array<RowAction> = [];

  if (session.status === "unmatched") {
    actions.push({ label: "Link client", icon: LinkIcon, onClick: () => handlers.onLink(session) });
  }
  if (client && session.status === "missing_fee") {
    actions.push({ label: "Set fee", icon: BanknoteIcon, onClick: () => handlers.onEditClient(client) });
  }
  // Covers whichever of the session and the package it bought has no receipt.
  const sources = receiptSources(session, handlers.packagesById.get(session.eventId));
  if (sources.length > 0) {
    actions.push({ label: "New receipt", icon: ReceiptIcon, onClick: () => handlers.onReceipt(sources) });
  }
  if (session.status === "ignored") {
    actions.push({ label: "Unignore", icon: EyeIcon, onClick: () => handlers.onIgnore(session, false) });
  } else if (!session.document && session.status !== "removed") {
    actions.push({ label: "Ignore", icon: EyeOffIcon, onClick: () => handlers.onIgnore(session, true) });
  }
  return actions;
}

export function createSessionColumns(handlers: SessionHandlers) {
  return helper.columns([
    helper.accessor("start", {
      header: "When",
      sortFn: "alphanumeric",
      meta: { search: (session: Session) => formatSessionTime(session.start) },
      cell: ({ getValue }) => <span className="whitespace-nowrap">{formatSessionTime(getValue())}</span>,
    }),
    helper.display({
      id: "who",
      header: "Client",
      meta: {
        search: (session: Session) => {
          const client = session.clientId ? handlers.clientsById.get(session.clientId) : undefined;
          return [client?.name, session.name, session.title];
        },
      },
      cell: ({ row }) => <SessionWho session={row.original} clientsById={handlers.clientsById} />,
    }),
    helper.accessor("status", {
      header: "Status",
      sortFn: "alphanumeric",
      meta: {
        search: (session: Session) => [
          SESSION_STATUS[session.status].label,
          session.drift ? "Changed after receipt" : undefined,
        ],
      },
      cell: ({ row }) => <SessionStatusCell session={row.original} />,
    }),
    helper.display({
      id: "amount",
      header: "Amount",
      meta: {
        search: (session: Session) => {
          const amount = sessionAmount(session);
          return [amount === undefined ? undefined : formatCents(amount), session.location === "home" ? "Home visit" : undefined];
        },
      },
      cell: ({ row }) => <SessionAmount session={row.original} />,
    }),
    helper.display({
      id: "receipt",
      header: "Receipt",
      meta: {
        search: (session: Session) =>
          sessionReceipts(session, handlers.packagesById.get(session.eventId)).map((ref) => ref.number ?? "Draft"),
      },
      cell: ({ row }) => <SessionReceipt session={row.original} handlers={handlers} />,
    }),
    helper.display({
      id: "actions",
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row }) => <RowActionButtons actions={sessionActions(row.original, handlers)} />,
    }),
  ]);
}
