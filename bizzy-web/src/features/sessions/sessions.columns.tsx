import { CheckIcon, HomeIcon } from "lucide-react";
import { allSessionDocuments, sessionAmount, stageBadges } from "./session-stage.util";
import type { ReactNode } from "react";
import type { SessionReturnTo, SessionView } from "./sessions.types";
import type { ClientView } from "~/features/clients/clients.types";
import type { PackageView } from "~/features/packages/packages.types";
import type { RowAction } from "~/components/shared/row-actions/row-actions.component";
import { Badge } from "~/components/ui/badge";
import { createDataTableColumnHelper } from "~/components/shared/data-table/data-table.config";
import { RowActionButtons } from "~/components/shared/row-actions/row-actions.component";
import { TextLink } from "~/components/shared/text-link/text-link.component";
import { documentRoute, refLabel } from "~/features/documents/documents.util";
import { formatCents } from "~/core/utils/money.util";
import { formatSessionTime } from "~/core/utils/date.util";
import { clientOf } from "~/features/clients/clients.util";

export interface SessionHandlers {
  /** Where the table is, for the session page to go back to. */
  from?: SessionReturnTo | undefined;
  clientsById: ReadonlyMap<string, ClientView>;
  packagesById: ReadonlyMap<string, PackageView>;
  onConfirm: (session: SessionView) => void;
}

const helper = createDataTableColumnHelper<SessionView>();

/** Who the session is with, linking to its page, where everything about it is. */
export function SessionWho({ session, handlers }: { session: SessionView; handlers: SessionHandlers }) {
  const client = clientOf(handlers.clientsById, session.clientId);
  return (
    <div className="flex flex-col items-start">
      <TextLink to="/sessions/$id" params={{ id: session.id }} search={{ from: handlers.from }}>
        {client?.name ?? session.clientName}
      </TextLink>
      {session.record.summary && <span className="text-xs text-muted-foreground">{session.record.summary}</span>}
    </div>
  );
}

/** Where it stands, or what is left to do; the session's page explains. */
export function SessionStageCell({ session }: { session: SessionView }) {
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

export function SessionAmount({ session }: { session: SessionView }) {
  const amount = sessionAmount(session);
  return (
    <span className="inline-flex items-center gap-1">
      {amount === undefined ? "—" : formatCents(amount)}
      {session.location === "visit" && <HomeIcon className="size-3.5 text-muted-foreground" aria-label="Home visit" />}
    </span>
  );
}

/** The invoices and receipts covering the session and the package its title bought. */
export function SessionDocuments({
  session,
  handlers,
  empty = "—",
}: {
  session: SessionView;
  handlers: SessionHandlers;
  /** Shown when there are none. */
  empty?: ReactNode;
}) {
  const docs = allSessionDocuments(session, boughtOf(session, handlers));
  if (docs.length === 0) return empty;

  return (
    <span className="flex flex-wrap items-center gap-2">
      {docs.map(({ type, ref, issued }) => (
        <TextLink key={ref.id} to={documentRoute(type)} params={{ id: ref.id }} className="text-sm">
          {refLabel(type, ref, issued)}
        </TextLink>
      ))}
    </span>
  );
}

function boughtOf(session: SessionView, handlers: SessionHandlers): PackageView | undefined {
  return session.bought ? handlers.packagesById.get(session.bought.id) : undefined;
}

/** The quick fixes a list can make; everything else is on the session's page. */
export function sessionActions(session: SessionView, handlers: SessionHandlers): Array<RowAction> {
  const actions: Array<RowAction> = [];
  if (session.todo.includes("confirm")) {
    actions.push({ label: "Confirm", icon: CheckIcon, onClick: () => handlers.onConfirm(session) });
  }
  return actions;
}

export function createSessionColumns(handlers: SessionHandlers) {
  return helper.columns([
    helper.accessor("start", {
      header: "When",
      sortFn: "alphanumeric",
      meta: { search: (session: SessionView) => formatSessionTime(session.start) },
      cell: ({ getValue }) => <span className="whitespace-nowrap">{formatSessionTime(getValue())}</span>,
    }),
    helper.display({
      id: "who",
      header: "Client",
      meta: {
        search: (session: SessionView) => {
          const client = clientOf(handlers.clientsById, session.clientId);
          return [client?.name ?? session.clientName, session.record.summary];
        },
      },
      cell: ({ row }) => <SessionWho session={row.original} handlers={handlers} />,
    }),
    helper.display({
      id: "stage",
      header: "Stage",
      meta: { search: (session: SessionView) => stageBadges(session).map((badge) => badge.label) },
      cell: ({ row }) => <SessionStageCell session={row.original} />,
    }),
    helper.display({
      id: "amount",
      header: "Amount",
      meta: {
        search: (session: SessionView) => {
          const amount = sessionAmount(session);
          return [amount === undefined ? undefined : formatCents(amount), session.location === "visit" ? "Home visit" : undefined];
        },
      },
      cell: ({ row }) => <SessionAmount session={row.original} />,
    }),
    helper.display({
      id: "documents",
      header: "Documents",
      meta: {
        search: (session: SessionView) =>
          allSessionDocuments(session, boughtOf(session, handlers)).map(({ type, ref, issued }) =>
            refLabel(type, ref, issued),
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
