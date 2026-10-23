import { CheckIcon, PackageIcon } from "lucide-react";
import {
  allSessionDocuments,
  coverText,
  creditInvoices,
  lengthAndPlace,
  recordText,
  sessionAmount,
  stageBadges,
} from "./session-stage.util";
import { SESSION_PLACES } from "./sessions.constant";
import type { LinkOptions } from "@tanstack/react-router";
import type { SessionHit, SessionSearch, SessionView } from "./sessions.types";
import type { ClientView } from "~/features/clients/clients.types";
import type { PackageView } from "~/features/packages/packages.types";
import type { Action } from "~/components/shared/actions/action-bar/action-bar.types";
import { Badge } from "~/components/ui/badge";
import { CellEmpty, CellText } from "~/components/shared/list/data-table/data-table-cell.component";
import { createDataTableColumnHelper } from "~/components/shared/list/data-table/data-table.config";
import { DataCard } from "~/components/shared/list/data-card/data-card.component";
import { RowActions } from "~/components/shared/actions/row-actions/row-actions.component";
import { TextLink } from "~/components/shared/link/text-link/text-link.component";
import { documentRoute, refLabel } from "~/features/documents/documents.util";
import { formatCents } from "~/core/utils/money.util";
import { formatSessionTime } from "~/core/utils/date.util";
import { clientOf } from "~/features/clients/clients.util";

export interface SessionHandlers {
  /** Where the table is and what it shows, for the session page to step through and go back to. */
  search?: SessionSearch | undefined;
  clientsById: ReadonlyMap<string, ClientView>;
  packagesById: ReadonlyMap<string, PackageView>;
  onConfirm: (session: SessionView) => void;
}

const helper = createDataTableColumnHelper<SessionHit>();

/** The session's page, remembering where the list is to go back to. */
export function sessionLink(id: string, search: SessionSearch | undefined): LinkOptions {
  return { to: "/sessions/$id", params: { id }, search: search ?? {} };
}

function clientNameOf(session: SessionView, handlers: SessionHandlers): string {
  return clientOf(handlers.clientsById, session.clientId)?.name ?? session.clientName;
}

/** Who the session is with, linking to the client's page; the row opens the session's. */
function SessionClient({ session, handlers }: { session: SessionView; handlers: SessionHandlers }) {
  const client = clientOf(handlers.clientsById, session.clientId);
  if (!client) return <span className="font-medium">{session.clientName}</span>;
  return (
    <TextLink to="/clients/$id" params={{ id: client.id }}>
      {client.name}
    </TextLink>
  );
}

/**
 * The summary, to tell sessions apart at a glance; under it the part of the
 * notes a search found it by, or what else was recorded.
 */
function SessionSummary({ session }: { session: SessionHit }) {
  const { summary } = session.record;
  return (
    <CellText
      title={summary || undefined}
      sub={session.excerpt ? <span className="italic">{session.excerpt}</span> : recordText(session.record)}
    >
      {summary || <span className="text-muted-foreground/60">No summary yet</span>}
    </CellText>
  );
}

/** Where it stands, or what is left to do; the session's page explains. */
function SessionStage({ session }: { session: SessionView }) {
  return (
    <div className="flex gap-1">
      {stageBadges(session).map((badge) => (
        <Badge key={badge.label} variant={badge.tone}>
          {badge.label}
        </Badge>
      ))}
    </div>
  );
}

/** What is billed in it, marked when that includes a package bought in it; Prepaid when credits pay it all. */
function AmountValue({ session }: { session: SessionView }) {
  const amount = sessionAmount(session);
  if (amount === undefined) return <span className="text-muted-foreground">Prepaid</span>;
  return (
    <span className="inline-flex items-center gap-1">
      {session.bought && <PackageIcon aria-hidden className="size-3.5 text-muted-foreground" />}
      {formatCents(amount)}
    </span>
  );
}

/** What is billed in it; under it what that is made of and which packages' credits pay for it. */
function SessionAmount({ session, handlers }: { session: SessionView; handlers: SessionHandlers }) {
  return (
    <CellText sub={coverText(session, handlers.packagesById)}>
      <AmountValue session={session} />
    </CellText>
  );
}

/**
 * The invoices and receipts covering the session and the package its title
 * bought; then, quieter, the invoices of packages bought before it whose
 * credits pay for it.
 */
function SessionDocuments({ session, handlers }: { session: SessionView; handlers: SessionHandlers }) {
  const docs = allSessionDocuments(session, boughtOf(session, handlers));
  const via = creditInvoices(session, handlers.packagesById);
  if (docs.length === 0 && via.length === 0) return <CellEmpty />;
  return (
    <span className="flex items-center gap-2">
      {docs.map(({ type, ref, issued }) => (
        <TextLink key={ref.id} to={documentRoute(type)} params={{ id: ref.id }} className="text-sm">
          {refLabel(type, ref, issued)}
        </TextLink>
      ))}
      {via.length > 0 && (
        <span className="flex items-center gap-1 text-sm text-muted-foreground">
          via
          {via.map(({ type, ref, issued }) => (
            <TextLink
              key={ref.id}
              to={documentRoute(type)}
              params={{ id: ref.id }}
              className="font-normal text-muted-foreground decoration-muted-foreground/30"
            >
              {refLabel(type, ref, issued)}
            </TextLink>
          ))}
        </span>
      )}
    </span>
  );
}

/** Every document label the Documents column shows, for searching it. */
function documentLabels(session: SessionView, handlers: SessionHandlers): Array<string> {
  const docs = [...allSessionDocuments(session, boughtOf(session, handlers)), ...creditInvoices(session, handlers.packagesById)];
  return docs.map(({ type, ref, issued }) => refLabel(type, ref, issued));
}

function boughtOf(session: SessionView, handlers: SessionHandlers): PackageView | undefined {
  return session.bought ? handlers.packagesById.get(session.bought.id) : undefined;
}

/** The quick fixes a list can make; everything else is on the session's page. */
export function sessionActions(session: SessionView, handlers: SessionHandlers): Array<Action> {
  const actions: Array<Action> = [];
  if (session.todo.includes("confirm")) {
    actions.push({ type: "button", label: "Confirm", icon: CheckIcon, onClick: () => handlers.onConfirm(session) });
  }
  return actions;
}

/** The phone layout of a row: who and where it stands, when and where, the summary; then Confirm. */
export function SessionCard({ session, handlers }: { session: SessionHit; handlers: SessionHandlers }) {
  return (
    <DataCard
      title={
        <>
          <SessionClient session={session} handlers={handlers} />
          <SessionStage session={session} />
        </>
      }
      value={<AmountValue session={session} />}
      meta={`${formatSessionTime(session.start)} · ${lengthAndPlace(session)}`}
      detail={session.excerpt ? <span className="italic">{session.excerpt}</span> : session.record.summary}
      detailTitle={session.excerpt ?? (session.record.summary || undefined)}
      actions={sessionActions(session, handlers)}
      open={sessionLink(session.id, handlers.search)}
    />
  );
}

export function createSessionColumns(handlers: SessionHandlers) {
  return helper.columns([
    helper.accessor("start", {
      header: "When",
      sortFn: "basic",
      meta: {
        search: (session: SessionView) => [formatSessionTime(session.start), SESSION_PLACES[session.location]],
      },
      cell: ({ row }) => <CellText sub={lengthAndPlace(row.original)}>{formatSessionTime(row.original.start)}</CellText>,
    }),
    helper.display({
      id: "client",
      header: "Client",
      meta: { search: (session: SessionView) => clientNameOf(session, handlers) },
      cell: ({ row }) => (
        <CellText className="max-w-48">
          <SessionClient session={row.original} handlers={handlers} />
        </CellText>
      ),
    }),
    helper.display({
      id: "summary",
      header: "Summary",
      meta: {
        width: "grow",
        search: (session: SessionHit) => [session.record.summary, session.excerpt],
      },
      cell: ({ row }) => <SessionSummary session={row.original} />,
    }),
    helper.display({
      id: "stage",
      header: "Stage",
      meta: { search: (session: SessionView) => stageBadges(session).map((badge) => badge.label) },
      cell: ({ row }) => <SessionStage session={row.original} />,
    }),
    helper.display({
      id: "amount",
      header: "Amount",
      meta: {
        align: "end",
        search: (session: SessionView) => {
          const amount = sessionAmount(session);
          return amount === undefined ? "Prepaid" : formatCents(amount);
        },
      },
      cell: ({ row }) => <SessionAmount session={row.original} handlers={handlers} />,
    }),
    helper.display({
      id: "documents",
      header: "Documents",
      meta: {
        from: "xl",
        search: (session: SessionView) => documentLabels(session, handlers),
      },
      cell: ({ row }) => <SessionDocuments session={row.original} handlers={handlers} />,
    }),
    helper.display({
      id: "actions",
      header: () => <span className="sr-only">Actions</span>,
      meta: { width: "fit" },
      cell: ({ row }) => <RowActions actions={sessionActions(row.original, handlers)} />,
    }),
  ]);
}
