import { Link } from "@tanstack/react-router";
import { HomeIcon, MoreHorizontalIcon, UserCheckIcon, UserPlusIcon } from "lucide-react";
import { SESSION_STATUS, receiptSources, sessionAmount, sessionReceipts } from "./session-status";
import type { ContactSuggestion, Session } from "./sessions.types";
import type { Client } from "~/features/clients/clients.types";
import type { DocumentSource } from "~/features/documents/documents.types";
import type { Package } from "~/features/packages/packages.types";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { createDataTableColumnHelper } from "~/components/shared/data-table/data-table.features";
import { formatCents } from "~/core/utils/money.util";
import { formatSessionTime } from "~/core/utils/date.util";

export interface SessionHandlers {
  clientsById: ReadonlyMap<string, Client>;
  /** Packages by ID; one bought in a session's title has the session's ID. */
  packagesById: ReadonlyMap<string, Package>;
  onLink: (session: Session) => void;
  /** Creates a client for the session's name, linked to the contact. */
  onCreateClient: (session: Session, contact: ContactSuggestion) => void;
  /** Adds the session's name to the client's calendar names. */
  onAddAlias: (session: Session, client: Client) => void;
  /** "Not a client": the contact stops being suggested. */
  onDismissContact: (contact: ContactSuggestion) => void;
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
  const settled = session.status === "priced" || session.status === "package";
  const note = session.drift ?? (settled ? undefined : (session.reason ?? status.hint));
  return (
    <div className="flex flex-col items-start gap-1">
      <div className="flex flex-wrap gap-1">
        <Badge variant={status.variant}>{status.label}</Badge>
        {session.drift && <Badge variant="destructive">Changed after receipt</Badge>}
      </div>
      {note && <span className="max-w-64 text-xs text-muted-foreground">{note}</span>}
    </div>
  );
}

/** One-tap fixes for an unmatched name that matches her contacts. */
export function SessionSuggestions({ session, handlers }: { session: Session; handlers: SessionHandlers }) {
  if (session.status !== "unmatched" || !session.suggestedContacts?.length) return null;

  return (
    <div className="flex flex-col items-start gap-1">
      {session.suggestedContacts.map((contact) => {
        const client = contact.clientId ? handlers.clientsById.get(contact.clientId) : undefined;
        return (
          <div key={contact.resourceName} className="flex flex-wrap items-center gap-1">
            {client ? (
              <Button variant="outline" size="xs" onClick={() => handlers.onAddAlias(session, client)}>
                <UserCheckIcon /> It's {client.name}
              </Button>
            ) : (
              <Button variant="outline" size="xs" onClick={() => handlers.onCreateClient(session, contact)}>
                <UserPlusIcon /> Add {contact.displayName} as a client
              </Button>
            )}
            {!client && (
              <Button variant="ghost" size="xs" onClick={() => handlers.onDismissContact(contact)}>
                Not a client
              </Button>
            )}
          </div>
        );
      })}
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
 * The receipt covering the session and the package its title bought, or a
 * button to make one covering whichever of the two has none yet.
 */
export function SessionReceipt({ session, handlers }: { session: Session; handlers: SessionHandlers }) {
  const bought = handlers.packagesById.get(session.eventId);
  const receipts = sessionReceipts(session, bought);
  const sources = receiptSources(session, bought);

  return (
    <span className="flex flex-wrap items-center gap-2">
      {receipts.map((ref) => (
        <Link
          key={ref.documentId}
          to="/receipts/$id"
          params={{ id: ref.documentId }}
          className="text-sm underline-offset-4 hover:underline"
        >
          {ref.number ?? "Draft"}
        </Link>
      ))}
      {sources.length > 0 && (
        <Button variant="outline" size="xs" onClick={() => handlers.onReceipt(sources)}>
          Receipt
        </Button>
      )}
    </span>
  );
}

export function SessionMenu({ session, handlers }: { session: Session; handlers: SessionHandlers }) {
  const client = session.clientId ? handlers.clientsById.get(session.clientId) : undefined;
  const items: Array<{ label: string; onClick: () => void }> = [];

  if (session.status === "unmatched") {
    items.push({ label: "Link to a client…", onClick: () => handlers.onLink(session) });
  }
  if (client && session.status === "missing_fee") {
    items.push({ label: `Set ${client.name}'s default fee…`, onClick: () => handlers.onEditClient(client) });
  }
  const sources = receiptSources(session, handlers.packagesById.get(session.eventId));
  if (sources.length > 0) {
    items.push({ label: "Create receipt", onClick: () => handlers.onReceipt(sources) });
  }
  if (session.status === "ignored") {
    items.push({ label: "Stop ignoring", onClick: () => handlers.onIgnore(session, false) });
  } else if (!session.document && session.status !== "removed") {
    items.push({ label: "Ignore", onClick: () => handlers.onIgnore(session, true) });
  }

  if (items.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Actions" />}>
        <MoreHorizontalIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto">
        {items.map((item) => (
          <DropdownMenuItem key={item.label} onClick={item.onClick}>
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function createSessionColumns(handlers: SessionHandlers) {
  return helper.columns([
    helper.accessor("start", {
      header: "When",
      sortFn: "alphanumeric",
      cell: ({ getValue }) => <span className="whitespace-nowrap">{formatSessionTime(getValue())}</span>,
    }),
    helper.display({
      id: "who",
      header: "Client",
      cell: ({ row }) => <SessionWho session={row.original} clientsById={handlers.clientsById} />,
    }),
    helper.accessor("status", {
      header: "Status",
      sortFn: "alphanumeric",
      cell: ({ row }) => (
        <div className="flex flex-col items-start gap-2">
          <SessionStatusCell session={row.original} />
          <SessionSuggestions session={row.original} handlers={handlers} />
        </div>
      ),
    }),
    helper.display({
      id: "amount",
      header: "Amount",
      cell: ({ row }) => <SessionAmount session={row.original} />,
    }),
    helper.display({
      id: "receipt",
      header: "Receipt",
      cell: ({ row }) => <SessionReceipt session={row.original} handlers={handlers} />,
    }),
    helper.display({
      id: "actions",
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row }) => <SessionMenu session={row.original} handlers={handlers} />,
    }),
  ]);
}
