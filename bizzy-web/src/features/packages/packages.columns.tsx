import { BanknoteIcon, PackageCheckIcon, PencilIcon, Trash2Icon } from "lucide-react";
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
  onDelete: (pkg: PackageView) => void;
  onMakeStandalone: (pkg: PackageView) => void;
  onPay: (pkg: PackageView) => void;
  /** Its WhatsApp menu: ask to pay, send for records, open the chat. */
  whatsapp: (pkg: PackageView) => Action;
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
 * What can be done to a package: pay what it owes or see its payment;
 * behind ⋯, WhatsApp the client (ask to pay, send its documents), edit it
 * (as a click on its row does, kept there for the keyboard), keep one bought in a session as its own (so the
 * session no longer buys it), or delete it: each as its `can` says.
 */
export function packageActions(pkg: PackageView, handlers: PackageHandlers): RowActionSet {
  const set = { actions: [] as Array<Action>, more: [] as Array<Action> };
  if (pkg.can.pay.ok) {
    set.actions.push({ type: "button", label: "Mark paid", icon: BanknoteIcon, onClick: () => handlers.onPay(pkg) });
  } else if (pkg.paid) {
    set.actions.push({ type: "button", label: "Payment", icon: BanknoteIcon, onClick: () => handlers.onPay(pkg) });
  }
  set.more.push(handlers.whatsapp(pkg));
  set.more.push({ type: "button", label: "Edit", icon: PencilIcon, onClick: () => handlers.onEdit(pkg) });
  if (pkg.can.makeStandalone.ok) {
    set.more.push({ type: "button", label: "Keep as its own", icon: PackageCheckIcon, onClick: () => handlers.onMakeStandalone(pkg) });
  }
  set.more.push({ type: "button", label: "Delete", icon: Trash2Icon, style: "destructive", can: pkg.can.delete, onClick: () => handlers.onDelete(pkg) });
  return set;
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
