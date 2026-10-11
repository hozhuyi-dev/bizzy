import { PencilIcon, ReceiptIcon, Trash2Icon } from "lucide-react";
import { creditsLeft } from "./packages.types";
import type { ReactNode } from "react";
import type { Package } from "./packages.types";
import type { Client } from "~/features/clients/clients.types";
import type { RowAction } from "~/components/shared/row-actions/row-actions.component";
import { Badge } from "~/components/ui/badge";
import { createDataTableColumnHelper } from "~/components/shared/data-table/data-table.features";
import { RowActionButtons } from "~/components/shared/row-actions/row-actions.component";
import { TextLink } from "~/components/shared/text-link/text-link.component";
import { formatCents } from "~/core/utils/money.util";
import { formatDate } from "~/core/utils/date.util";

export interface PackageHandlers {
  clientsById: ReadonlyMap<string, Client>;
  onEdit: (pkg: Package) => void;
  onDelete: (pkg: Package) => void;
  onReceipt: (pkg: Package) => void;
}

const helper = createDataTableColumnHelper<Package>();

export function clientName(pkg: Package, clientsById: ReadonlyMap<string, Client>): string {
  return clientsById.get(pkg.clientId)?.name ?? "Unknown client";
}

export function PackageCredits({ pkg }: { pkg: Package }) {
  return (
    <span className="flex flex-col">
      <span>
        {creditsLeft(pkg)} of {pkg.sessions} left
      </span>
      {pkg.drift && <span className="max-w-64 text-xs text-destructive">{pkg.drift}</span>}
    </span>
  );
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

export function PackageReceipt({
  pkg,
  empty = "—",
}: {
  pkg: Package;
  /** Shown when there is no receipt yet. */
  empty?: ReactNode;
}) {
  if (!pkg.document) return empty;
  return (
    <TextLink to="/receipts/$id" params={{ id: pkg.document.documentId }} className="text-sm">
      {pkg.document.number ?? "Draft"}
    </TextLink>
  );
}

/** Calendar packages are changed in the calendar; only app ones are editable here. */
export function packageActions(pkg: Package, handlers: PackageHandlers): Array<RowAction> {
  const actions: Array<RowAction> = [];
  if (pkg.document) return actions;
  if (!pkg.removed) {
    actions.push({ label: "New receipt", icon: ReceiptIcon, onClick: () => handlers.onReceipt(pkg) });
  }
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
    helper.display({
      id: "source",
      header: "From",
      meta: { search: (pkg: Package) => [pkg.source === "calendar" ? "Calendar" : "Added here", pkg.note] },
      cell: ({ row }) => <PackageSource pkg={row.original} />,
    }),
    helper.display({
      id: "receipt",
      header: "Receipt",
      meta: { search: (pkg: Package) => pkg.document?.number ?? (pkg.document ? "Draft" : undefined) },
      cell: ({ row }) => <PackageReceipt pkg={row.original} />,
    }),
    helper.display({
      id: "actions",
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row }) => <RowActionButtons actions={packageActions(row.original, handlers)} />,
    }),
  ]);
}
