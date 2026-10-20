import { CheckIcon } from "lucide-react";
import { allSessionDocuments, coverText, lengthAndPlace, recordText, sessionAmount, stageBadges } from "./session-stage.util";
import { SESSION_PLACES } from "./sessions.constant";
import type { LinkOptions } from "@tanstack/react-router";
import type { SessionHit, SessionReturnTo, SessionView } from "./sessions.types";
import type { ClientView } from "~/features/clients/clients.types";
import type { PackageView } from "~/features/packages/packages.types";
import type { Action } from "~/components/shared/action-bar/action-bar.component";
import { Badge } from "~/components/ui/badge";
import { CellEmpty, CellText, RowLink } from "~/components/shared/data-table/data-table-cell.component";
import { createDataTableColumnHelper } from "~/components/shared/data-table/data-table.config";
import { DataCard } from "~/components/shared/data-card/data-card.component";
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

const helper = createDataTableColumnHelper<SessionHit>();

/** The session's page, remembering where the list is to go back to. */
export function sessionLink(session: SessionView, from: SessionReturnTo | undefined): LinkOptions {
  return { to: "/sessions/$id", params: { id: session.id }, search: { from } };
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

/** Its fee, or Prepaid when credits pay it all; under it what credits pay and the package it buys. */
function SessionAmount({ session }: { session: SessionView }) {
  const amount = sessionAmount(session);
  return (
    <CellText sub={coverText(session)}>
      {amount === undefined ? <span className="text-muted-foreground">Prepaid</span> : formatCents(amount)}
    </CellText>
  );
}

/** The invoices and receipts covering the session and the package its title bought. */
function SessionDocuments({ session, handlers }: { session: SessionView; handlers: SessionHandlers }) {
  const docs = allSessionDocuments(session, boughtOf(session, handlers));
  if (docs.length === 0) return <CellEmpty />;
  return (
    <span className="flex items-center gap-2">
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
export function sessionActions(session: SessionView, handlers: SessionHandlers): Array<Action> {
  const actions: Array<Action> = [];
  if (session.todo.includes("confirm")) {
    actions.push({ type: "button", label: "Confirm", icon: CheckIcon, onClick: () => handlers.onConfirm(session) });
  }
  return actions;
}

/** The phone layout of a row: who and where it stands, when and where, the summary; then Confirm and Open. */
export function SessionCard({ session, handlers }: { session: SessionHit; handlers: SessionHandlers }) {
  const amount = sessionAmount(session);
  return (
    <DataCard
      title={
        <>
          <SessionClient session={session} handlers={handlers} />
          <SessionStage session={session} />
        </>
      }
      value={amount === undefined ? <span className="text-muted-foreground">Prepaid</span> : formatCents(amount)}
      meta={`${formatSessionTime(session.start)} · ${lengthAndPlace(session)}`}
      detail={session.excerpt ? <span className="italic">{session.excerpt}</span> : session.record.summary}
      detailTitle={session.excerpt ?? (session.record.summary || undefined)}
      actions={sessionActions(session, handlers)}
      open={sessionLink(session, handlers.from)}
    />
  );
}

export function createSessionColumns(handlers: SessionHandlers) {
  return helper.columns([
    helper.accessor("start", {
      header: "When",
      sortFn: "alphanumeric",
      meta: {
        search: (session: SessionView) => [formatSessionTime(session.start), SESSION_PLACES[session.location]],
      },
      // The way into the session by keyboard; the whole row opens it too.
      cell: ({ row }) => (
        <CellText sub={lengthAndPlace(row.original)}>
          <RowLink {...sessionLink(row.original, handlers.from)} className="font-normal">
            {formatSessionTime(row.original.start)}
          </RowLink>
        </CellText>
      ),
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
      cell: ({ row }) => <SessionAmount session={row.original} />,
    }),
    helper.display({
      id: "documents",
      header: "Documents",
      meta: {
        from: "xl",
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
      meta: { width: "fit" },
      cell: ({ row }) => <RowActionButtons actions={sessionActions(row.original, handlers)} />,
    }),
  ]);
}
