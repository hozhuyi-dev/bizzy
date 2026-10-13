import { BanknoteIcon, FileTextIcon, PencilIcon, ReceiptIcon, Trash2Icon } from "lucide-react";
import { canReceiptPackage, creditsLeft, isSettled } from "./packages.types";
import type { ReactNode } from "react";
import type { Package } from "./packages.types";
import type { Client } from "~/features/clients/clients.types";
import type { DocumentType } from "~/features/documents/documents.types";
import type { RowAction } from "~/components/shared/row-actions/row-actions.component";
import { Badge } from "~/components/ui/badge";
import { createDataTableColumnHelper } from "~/components/shared/data-table/data-table.features";
import { RowActionButtons } from "~/components/shared/row-actions/row-actions.component";
import { TextLink } from "~/components/shared/text-link/text-link.component";
import { formatCents } from "~/core/utils/money.util";
import { formatDate } from "~/core/utils/date.util";
import { documentLabel, documentRoute } from "~/features/documents/documents.registry";
import { PAYMENT_METHODS } from "~/features/payments/payments.types";

export interface PackageHandlers {
  clientsById: ReadonlyMap<string, Client>;
  onEdit: (pkg: Package) => void;
  onDelete: (pkg: Package) => void;
  onPay: (pkg: Package) => void;
  onDocument: (type: DocumentType, pkg: Package) => void;
}

const DOCUMENT_TYPES_ORDER: ReadonlyArray<DocumentType> = ["invoice", "receipt"];

const helper = createDataTableColumnHelper<Package>();

export function clientName(pkg: Package, clientsById: ReadonlyMap<string, Client>): string {
  return clientsById.get(pkg.clientId)?.name ?? "Unknown client";
}

export function PackageCredits({ pkg }: { pkg: Package }) {
  return (
    <span>
      {creditsLeft(pkg)} of {pkg.sessions} left
    </span>
  );
}

/** "Paid · TnG · 12 Oct", "Waived" or "Unpaid". */
export function paymentText(pkg: Package): string {
  const { payment } = pkg;
  if (!payment) return isSettled(pkg) ? "Free" : "Unpaid";
  if (payment.status === "waived") return "Waived";
  const method = PAYMENT_METHODS.find((m) => m.value === payment.method)?.short;
  return ["Paid", method, formatDate(payment.paidOn)].filter(Boolean).join(" · ");
}

export function PackagePayment({ pkg }: { pkg: Package }) {
  if (!isSettled(pkg)) return <Badge variant="attention">Unpaid</Badge>;
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
      <Badge variant="neutral">{pkg.source === "calendar" ? "Calendar" : "Added here"}</Badge>
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
 * Calendar packages are changed in the calendar; only app ones (and ones
 * unlinked from their session) are editable here. A receipt needs payment.
 */
export function packageActions(pkg: Package, handlers: PackageHandlers): Array<RowAction> {
  const actions: Array<RowAction> = [];
  if (!isSettled(pkg)) {
    actions.push({ label: "Mark paid", icon: BanknoteIcon, onClick: () => handlers.onPay(pkg) });
  }
  if (!pkg.invoice) {
    actions.push({ label: "New invoice", icon: FileTextIcon, onClick: () => handlers.onDocument("invoice", pkg) });
  }
  if (canReceiptPackage(pkg)) {
    actions.push({ label: "New receipt", icon: ReceiptIcon, onClick: () => handlers.onDocument("receipt", pkg) });
  }
  if (pkg.payment && !pkg.receipt) {
    actions.push({ label: "Payment", icon: BanknoteIcon, onClick: () => handlers.onPay(pkg) });
  }
  if (pkg.invoice || pkg.receipt) return actions;
  if (pkg.source === "app") {
    actions.push(
      { label: "Edit", icon: PencilIcon, onClick: () => handlers.onEdit(pkg) },
      { label: "Delete", icon: Trash2Icon, destructive: true, onClick: () => handlers.onDelete(pkg) },
    );
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
    helper.accessor((pkg) => creditsLeft(pkg), {
      id: "credits",
      header: "Credits",
      sortFn: "basic",
      meta: { search: (pkg: Package) => `${creditsLeft(pkg)} of ${pkg.sessions} left` },
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
      meta: { search: (pkg: Package) => [pkg.source === "calendar" ? "Calendar" : "Added here", pkg.note] },
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
