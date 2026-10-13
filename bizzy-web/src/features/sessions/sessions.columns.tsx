import { BanknoteIcon, CheckIcon, HomeIcon, LinkIcon } from "lucide-react";
import { allSessionDocuments, isUnmatched, sessionAmount, stageBadges } from "./session-stage.util";
import type { ReactNode } from "react";
import type { Session, SessionReturnTo  } from "./sessions.types";
import type { Client } from "~/features/clients/clients.types";
import type { Package } from "~/features/packages/packages.types";
import type { RowAction } from "~/components/shared/row-actions/row-actions.component";
import { Badge } from "~/components/ui/badge";
import { createDataTableColumnHelper } from "~/components/shared/data-table/data-table.config";
import { RowActionButtons } from "~/components/shared/row-actions/row-actions.component";
import { TextLink } from "~/components/shared/text-link/text-link.component";
import { documentLabel, documentRoute } from "~/features/documents/documents.util";
import { formatCents } from "~/core/utils/money.util";
import { formatSessionTime } from "~/core/utils/date.util";
import { clientOf } from "~/features/clients/clients.util";

export interface SessionHandlers {
  /** Where the table is, for the session page to go back to. */
  from?: SessionReturnTo | undefined;
  clientsById: ReadonlyMap<string, Client>;
  /** Packages by ID; one bought in a session's title has the session's ID. */
  packagesById: ReadonlyMap<string, Package>;
  onLink: (session: Session) => void;
  onEditClient: (client: Client) => void;
  onConfirm: (session: Session) => void;
}

const helper = createDataTableColumnHelper<Session>();

/** Who the session is with, linking to its page, where everything about it is. */
export function SessionWho({ session, handlers }: { session: Session; handlers: SessionHandlers }) {
  const client = clientOf(handlers.clientsById, session.clientId);
  return (
    <div className="flex flex-col items-start">
      <TextLink
        to="/sessions/$id"
        params={{ id: session.eventId }}
        search={{ from: handlers.from }}
        className={client ? undefined : "text-muted-foreground italic"}
      >
        {client?.name ?? (session.name || session.title)}
      </TextLink>
      <span className="text-xs text-muted-foreground">{session.record?.summary ?? session.title}</span>
    </div>
  );
}

/** Where it stands, or what is left to do; the session's page explains. */
export function SessionStageCell({ session }: { session: Session }) {
  return (
    <div className="flex flex-wrap gap-1">
      {stageBadges(session).map((badge) => (
        <Badge key={badge.label} variant={badge.tone}>
          {badge.label}
        </Badge>
      ))}
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

/** The invoices and receipts covering the session and the package its title bought. */
export function SessionDocuments({
  session,
  handlers,
  empty = "—",
}: {
  session: Session;
  handlers: SessionHandlers;
  /** Shown when there are none. */
  empty?: ReactNode;
}) {
  const docs = allSessionDocuments(session, handlers.packagesById.get(session.eventId));
  if (docs.length === 0) return empty;

  return (
    <span className="flex flex-wrap items-center gap-2">
      {docs.map(({ type, ref }) => (
        <TextLink key={ref.documentId} to={documentRoute(type)} params={{ id: ref.documentId }} className="text-sm">
          {documentLabel(ref.number, ref.revision)}
        </TextLink>
      ))}
    </span>
  );
}

/** The quick fixes a list can make; everything else is on the session's page. */
export function sessionActions(session: Session, handlers: SessionHandlers): Array<RowAction> {
  const client = clientOf(handlers.clientsById, session.clientId);
  // A document fixes what it covers: cancel it to change the booking.
  const editable = allSessionDocuments(session, handlers.packagesById.get(session.eventId)).length === 0;
  const actions: Array<RowAction> = [];

  if (editable && session.status === "tentative" && client) {
    actions.push({ label: "Confirm", icon: CheckIcon, onClick: () => handlers.onConfirm(session) });
  }
  if (isUnmatched(session)) {
    actions.push({ label: "Link client", icon: LinkIcon, onClick: () => handlers.onLink(session) });
  }
  if (client && session.status === "missing_fee") {
    actions.push({ label: "Set fee", icon: BanknoteIcon, onClick: () => handlers.onEditClient(client) });
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
          const client = clientOf(handlers.clientsById, session.clientId);
          return [client?.name, session.name, session.title, session.record?.summary];
        },
      },
      cell: ({ row }) => <SessionWho session={row.original} handlers={handlers} />,
    }),
    helper.display({
      id: "stage",
      header: "Stage",
      meta: { search: (session: Session) => stageBadges(session).map((badge) => badge.label) },
      cell: ({ row }) => <SessionStageCell session={row.original} />,
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
      id: "documents",
      header: "Documents",
      meta: {
        search: (session: Session) =>
          allSessionDocuments(session, handlers.packagesById.get(session.eventId)).map(({ ref }) =>
            documentLabel(ref.number, ref.revision),
          ),
      },
      cell: ({ row }) => <SessionDocuments session={row.original} handlers={handlers} />,
    }),
    helper.display({
      id: "actions",
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row }) => <RowActionButtons actions={sessionActions(row.original, handlers)} />,
    }),
  ]);
}
