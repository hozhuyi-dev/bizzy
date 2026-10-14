import { BanknoteIcon, PackageCheckIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { clientName, paymentText } from "./packages.util";
import type { ReactNode } from "react";
import type { Package } from "./packages.types";
import type { Client } from "~/features/clients/clients.types";
import type { DocumentType } from "~/features/documents/documents.types";
import type { RowAction } from "~/components/shared/row-actions/row-actions.component";
import { Badge } from "~/components/ui/badge";
import { createDataTableColumnHelper } from "~/components/shared/data-table/data-table.config";
import { RowActionButtons } from "~/components/shared/row-actions/row-actions.component";
import { TextLink } from "~/components/shared/text-link/text-link.component";
import { formatCents } from "~/core/utils/money.util";
import { formatDate } from "~/core/utils/date.util";
import { documentLabel, documentRoute } from "~/features/documents/documents.util";

export interface PackageHandlers {
  clientsById: ReadonlyMap<string, Client>;
  onEdit: (pkg: Package) => void;
  onDelete: (pkg: Package) => void;
  onMakeStandalone: (pkg: Package) => void;
  onPay: (pkg: Package) => void;
}

const DOCUMENT_TYPES_ORDER: ReadonlyArray<DocumentType> = ["invoice", "receipt"];

const helper = createDataTableColumnHelper<Package>();

export function PackageCredits({ pkg }: { pkg: Package }) {
  return (
    <span>
      {pkg.creditsLeft} of {pkg.sessions} left
    </span>
  );
}

export function PackagePayment({ pkg }: { pkg: Package }) {
  if (pkg.owedCents > 0) return <Badge variant="attention">Unpaid</Badge>;
  return <span className="text-sm text-muted-foreground">{paymentText(pkg)}</span>;
}

export function PackagePrice({ pkg }: { pkg: Package }) {
  return (
    <span className="flex flex-col">
      <span>{formatCents(pkg.priceCents)}</span>
      <span className="text-xs text-muted-foreground">
        {formatCents(Math.round(pkg.priceCents / pkg.sessions))} each
      </span>
    </span>
  );
}

export function PackageSource({ pkg }: { pkg: Package }) {
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
  pkg: Package;
  /** Shown when there is none yet. */
  empty?: ReactNode;
}) {
  const docs = DOCUMENT_TYPES_ORDER.flatMap((type) => {
    const ref = pkg[type];
    return ref ? [{ type, ref }] : [];
  });
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

/**
 * What can be done to a package, as the API's guards say: one bought in a
 * session can be kept as its own, so the session no longer buys it.
 */
export function packageActions(pkg: Package, handlers: PackageHandlers): Array<RowAction> {
  const actions: Array<RowAction> = [];
  if (pkg.owedCents > 0 && pkg.can.pay.ok) {
    actions.push({ label: "Mark paid", icon: BanknoteIcon, onClick: () => handlers.onPay(pkg) });
  }
  if (pkg.paid) {
    actions.push({ label: "Payment", icon: BanknoteIcon, onClick: () => handlers.onPay(pkg) });
  }
  if (pkg.can.makeStandalone.ok) {
    actions.push({ label: "Keep as its own", icon: PackageCheckIcon, onClick: () => handlers.onMakeStandalone(pkg) });
  }
  if (pkg.can.edit.ok) actions.push({ label: "Edit", icon: PencilIcon, onClick: () => handlers.onEdit(pkg) });
  if (pkg.can.delete.ok) {
    actions.push({ label: "Delete", icon: Trash2Icon, destructive: true, onClick: () => handlers.onDelete(pkg) });
  }
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
      meta: { search: (pkg: Package) => formatDate(pkg.purchasedAt) },
      cell: ({ getValue }) => formatDate(getValue()),
    }),
    helper.accessor((pkg) => pkg.creditsLeft, {
      id: "credits",
      header: "Credits",
      sortFn: "basic",
      meta: { search: (pkg: Package) => `${pkg.creditsLeft} of ${pkg.sessions} left` },
      cell: ({ row }) => <PackageCredits pkg={row.original} />,
    }),
    helper.accessor("priceCents", {
      header: "Price",
      sortFn: "basic",
      meta: { search: (pkg: Package) => formatCents(pkg.priceCents) },
      cell: ({ row }) => <PackagePrice pkg={row.original} />,
    }),
    helper.accessor((pkg) => paymentText(pkg), {
      id: "payment",
      header: "Payment",
      sortFn: "alphanumeric",
      meta: { search: (pkg: Package) => paymentText(pkg) },
      cell: ({ row }) => <PackagePayment pkg={row.original} />,
    }),
    helper.display({
      id: "source",
      header: "From",
      meta: { search: (pkg: Package) => [pkg.boughtIn ? "In a session" : "On its own", pkg.note] },
      cell: ({ row }) => <PackageSource pkg={row.original} />,
    }),
    helper.display({
      id: "documents",
      header: "Documents",
      meta: {
        search: (pkg: Package) =>
          DOCUMENT_TYPES_ORDER.map((type) => pkg[type]).flatMap((ref) => (ref ? [documentLabel(ref.number, ref.revision)] : [])),
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
