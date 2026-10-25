import { clientName, paymentText } from "./packages.util";
import type { PackageView } from "./packages.types";
import type { ClientView } from "~/features/clients/clients.types";
import type { Action } from "~/components/shared/actions/action-bar/action-bar.types";
import type { RowActionSet } from "~/components/shared/actions/row-actions/row-actions.component";
import { Badge } from "~/components/ui/badge";
import { CellEmpty, CellText } from "~/components/shared/list/data-table/data-table-cell.component";
import { createDataTableColumnHelper } from "~/components/shared/list/data-table/data-table.config";
import { DataCard } from "~/components/shared/list/data-card/data-card.component";
import { RowActions } from "~/components/shared/actions/row-actions/row-actions.component";
import { TextLink } from "~/components/shared/link/text-link/text-link.component";
import { formatCents } from "~/core/utils/money.util";
import { formatDate, formatHours } from "~/core/utils/date.util";
import { coveringDocuments, documentRoute, refLabel } from "~/features/documents/documents.util";

export interface PackageHandlers {
  clientsById: ReadonlyMap<string, ClientView>;
  onEdit: (pkg: PackageView) => void;
  /** Paid ▾ on one owed something (usePaidAction), the same as wherever else it is listed. */
  paid: (pkg: PackageView) => Action;
}

const helper = createDataTableColumnHelper<PackageView>();

function creditsText(pkg: PackageView): string {
  return `${formatHours(pkg.creditsLeft)} of ${formatHours(pkg.hours)} left`;
}

function sourceText(pkg: PackageView): string {
  return pkg.boughtIn ? "In a session" : "On its own";
}

/** The client, linking to their page. */
function PackageClient({ pkg, handlers }: { pkg: PackageView; handlers: PackageHandlers }) {
  const client = handlers.clientsById.get(pkg.clientId);
  if (!client) return <span className="text-muted-foreground italic">{clientName(pkg, handlers.clientsById)}</span>;
  return (
    <TextLink to="/clients/$id" params={{ id: client.id }}>
      {client.name}
    </TextLink>
  );
}

/** The credits left, and a bar of how much is used. */
function PackageCredits({ pkg }: { pkg: PackageView }) {
  const left = pkg.hours > 0 ? pkg.creditsLeft / pkg.hours : 0;
  return (
    <div className="flex flex-col gap-1.5">
      <span>{creditsText(pkg)}</span>
      <div
        role="meter"
        aria-label="Credits left"
        aria-valuemin={0}
        aria-valuemax={pkg.hours}
        aria-valuenow={pkg.creditsLeft}
        className="h-1 w-full min-w-20 overflow-hidden rounded-full bg-muted"
      >
        <div className="h-full rounded-full bg-foreground/35" style={{ width: `${left * 100}%` }} />
      </div>
    </div>
  );
}

function PackagePayment({ pkg }: { pkg: PackageView }) {
  if (pkg.owedCents > 0) return <Badge variant="attention">Unpaid</Badge>;
  return <span className="text-muted-foreground">{paymentText(pkg)}</span>;
}

/** The invoice and receipt covering the package, if any. */
function PackageDocuments({ pkg }: { pkg: PackageView }) {
  const docs = coveringDocuments(pkg);
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

/**
 * A package's one quick action: Paid ▾ while it owes something. Everything
 * else (WhatsApp, keeping one bought in a session as its own, delete) is in
 * its page, which a click on its row opens.
 */
export function packageActions(pkg: PackageView, handlers: PackageHandlers): RowActionSet {
  return { actions: pkg.can.pay.ok ? [handlers.paid(pkg)] : [] };
}

/** The phone layout of a row: who, the price, credits left and when bought, the note; then its actions. */
export function PackageCard({ pkg, handlers }: { pkg: PackageView; handlers: PackageHandlers }) {
  return (
    <DataCard
      title={
        <>
          <PackageClient pkg={pkg} handlers={handlers} />
          {pkg.owedCents > 0 && <Badge variant="attention">Unpaid</Badge>}
        </>
      }
      value={formatCents(pkg.priceCents)}
      meta={`${creditsText(pkg)} · bought ${formatDate(pkg.purchasedAt)}`}
      detail={[sourceText(pkg), pkg.note].filter(Boolean).join(" · ")}
      detailTitle={pkg.note}
      {...packageActions(pkg, handlers)}
      onOpen={() => handlers.onEdit(pkg)}
    />
  );
}

export function createPackageColumns(handlers: PackageHandlers) {
  return helper.columns([
    helper.accessor((pkg) => clientName(pkg, handlers.clientsById), {
      id: "client",
      header: "Client",
      sortFn: "alphanumeric",
      meta: {
        width: "grow",
        search: (pkg: PackageView) => [clientName(pkg, handlers.clientsById), pkg.note],
      },
      cell: ({ row }) => (
        <CellText sub={row.original.note} title={row.original.note}>
          <PackageClient pkg={row.original} handlers={handlers} />
        </CellText>
      ),
    }),
    helper.accessor("purchasedAt", {
      header: "Bought",
      sortFn: "basic",
      meta: { search: (pkg: PackageView) => [formatDate(pkg.purchasedAt), sourceText(pkg)] },
      cell: ({ row }) => <CellText sub={sourceText(row.original)}>{formatDate(row.original.purchasedAt)}</CellText>,
    }),
    helper.accessor((pkg) => pkg.creditsLeft, {
      id: "credits",
      header: "Credits",
      sortFn: "basic",
      meta: { search: (pkg: PackageView) => creditsText(pkg) },
      cell: ({ row }) => <PackageCredits pkg={row.original} />,
    }),
    helper.accessor((pkg) => paymentText(pkg), {
      id: "payment",
      header: "Payment",
      sortFn: "alphanumeric",
      meta: { search: (pkg: PackageView) => paymentText(pkg) },
      cell: ({ row }) => <PackagePayment pkg={row.original} />,
    }),
    helper.display({
      id: "documents",
      header: "Documents",
      meta: {
        from: "xl",
        search: (pkg: PackageView) => coveringDocuments(pkg).map(({ type, ref, issued }) => refLabel(type, ref, issued)),
      },
      cell: ({ row }) => <PackageDocuments pkg={row.original} />,
    }),
    helper.accessor("priceCents", {
      header: "Price",
      sortFn: "basic",
      meta: { align: "end", search: (pkg: PackageView) => formatCents(pkg.priceCents) },
      cell: ({ row }) => (
        <CellText sub={`${formatCents(Math.round(row.original.priceCents / row.original.hours))} an hour`}>
          {formatCents(row.original.priceCents)}
        </CellText>
      ),
    }),
    helper.display({
      id: "actions",
      header: () => <span className="sr-only">Actions</span>,
      meta: { width: "fit" },
      cell: ({ row }) => <RowActions {...packageActions(row.original, handlers)} />,
    }),
  ]);
}
