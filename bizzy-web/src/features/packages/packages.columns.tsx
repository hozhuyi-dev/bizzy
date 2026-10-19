import { BanknoteIcon, PackageCheckIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { clientName, paymentText } from "./packages.util";
import type { ReactNode } from "react";
import type { PackageView } from "./packages.types";
import type { ClientView } from "~/features/clients/clients.types";
import type { Action } from "~/components/shared/action-bar/action-bar.component";
import { Badge } from "~/components/ui/badge";
import { createDataTableColumnHelper } from "~/components/shared/data-table/data-table.config";
import { RowActionButtons } from "~/components/shared/row-actions/row-actions.component";
import { TextLink } from "~/components/shared/text-link/text-link.component";
import { formatCents } from "~/core/utils/money.util";
import { formatDate, formatHours } from "~/core/utils/date.util";
import { coveringDocuments, documentRoute, refLabel } from "~/features/documents/documents.util";

export interface PackageHandlers {
  clientsById: ReadonlyMap<string, ClientView>;
  onEdit: (pkg: PackageView) => void;
  onDelete: (pkg: PackageView) => void;
  onMakeStandalone: (pkg: PackageView) => void;
  onPay: (pkg: PackageView) => void;
}

const helper = createDataTableColumnHelper<PackageView>();

export function PackageCredits({ pkg }: { pkg: PackageView }) {
  return (
    <span>
      {formatHours(pkg.creditsLeft)} of {formatHours(pkg.hours)} left
    </span>
  );
}

export function PackagePayment({ pkg }: { pkg: PackageView }) {
  if (pkg.owedCents > 0) return <Badge variant="attention">Unpaid</Badge>;
  return <span className="text-sm text-muted-foreground">{paymentText(pkg)}</span>;
}

export function PackagePrice({ pkg }: { pkg: PackageView }) {
  return (
    <span className="flex flex-col">
      <span>{formatCents(pkg.priceCents)}</span>
      <span className="text-xs text-muted-foreground">
        {formatCents(Math.round(pkg.priceCents / pkg.hours))} an hour
      </span>
    </span>
  );
}

export function PackageSource({ pkg }: { pkg: PackageView }) {
  return (
    <span className="flex flex-wrap items-center gap-1">
      <Badge variant="neutral">{pkg.boughtIn ? "In a session" : "On its own"}</Badge>
      {pkg.note && <span className="text-xs text-muted-foreground">{pkg.note}</span>}
    </span>
  );
}

/** The invoice and receipt covering the package, if any. */
export function PackageDocuments({
  pkg,
  empty = "—",
}: {
  pkg: PackageView;
  /** Shown when there is none yet. */
  empty?: ReactNode;
}) {
  const docs = coveringDocuments(pkg);
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

/**
 * What can be done to a package: pay what it owes, see its payment, keep
 * one bought in a session as its own (so the session no longer buys it),
 * edit or delete it. The API refuses what its rules don't allow, with what
 * would let it through.
 */
export function packageActions(pkg: PackageView, handlers: PackageHandlers): Array<Action> {
  const actions: Array<Action> = [];
  if (pkg.owedCents > 0) {
    actions.push({ type: "button", label: "Mark paid", icon: BanknoteIcon, onClick: () => handlers.onPay(pkg) });
  }
  if (pkg.paid) {
    actions.push({ type: "button", label: "Payment", icon: BanknoteIcon, onClick: () => handlers.onPay(pkg) });
  }
  if (pkg.boughtIn) {
    actions.push({ type: "button", label: "Keep as its own", icon: PackageCheckIcon, onClick: () => handlers.onMakeStandalone(pkg) });
  }
  actions.push(
    { type: "button", label: "Edit", icon: PencilIcon, onClick: () => handlers.onEdit(pkg) },
    { type: "button", label: "Delete", icon: Trash2Icon, style: "destructive", onClick: () => handlers.onDelete(pkg) },
  );
  return actions;
}

export function createPackageColumns(handlers: PackageHandlers) {
  return helper.columns([
    helper.accessor((pkg) => clientName(pkg, handlers.clientsById), {
      id: "client",
      header: "Client",
      sortFn: "alphanumeric",
      cell: ({ getValue }) => <span className="font-medium">{getValue()}</span>,
    }),
    helper.accessor("purchasedAt", {
      header: "Bought",
      sortFn: "alphanumeric",
      meta: { search: (pkg: PackageView) => formatDate(pkg.purchasedAt) },
      cell: ({ getValue }) => formatDate(getValue()),
    }),
    helper.accessor((pkg) => pkg.creditsLeft, {
      id: "credits",
      header: "Credits",
      sortFn: "basic",
      meta: { search: (pkg: PackageView) => `${formatHours(pkg.creditsLeft)} of ${formatHours(pkg.hours)} left` },
      cell: ({ row }) => <PackageCredits pkg={row.original} />,
    }),
    helper.accessor("priceCents", {
      header: "Price",
      sortFn: "basic",
      meta: { search: (pkg: PackageView) => formatCents(pkg.priceCents) },
      cell: ({ row }) => <PackagePrice pkg={row.original} />,
    }),
    helper.accessor((pkg) => paymentText(pkg), {
      id: "payment",
      header: "Payment",
      sortFn: "alphanumeric",
      meta: { search: (pkg: PackageView) => paymentText(pkg) },
      cell: ({ row }) => <PackagePayment pkg={row.original} />,
    }),
    helper.display({
      id: "source",
      header: "From",
      meta: { search: (pkg: PackageView) => [pkg.boughtIn ? "In a session" : "On its own", pkg.note] },
      cell: ({ row }) => <PackageSource pkg={row.original} />,
    }),
    helper.display({
      id: "documents",
      header: "Documents",
      meta: {
        search: (pkg: PackageView) => coveringDocuments(pkg).map(({ type, ref, issued }) => refLabel(type, ref, issued)),
      },
      cell: ({ row }) => <PackageDocuments pkg={row.original} />,
    }),
    helper.display({
      id: "actions",
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row }) => <RowActionButtons actions={packageActions(row.original, handlers)} />,
    }),
  ]);
}
