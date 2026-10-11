import { Link } from "@tanstack/react-router";
import { MoreHorizontalIcon } from "lucide-react";
import { creditsLeft } from "./packages.types";
import type { Package } from "./packages.types";
import type { Client } from "~/features/clients/clients.types";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { createDataTableColumnHelper } from "~/components/shared/data-table/data-table.features";
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
      <Badge variant="outline">{pkg.source === "calendar" ? "Calendar" : "Added here"}</Badge>
      {pkg.note && <span className="text-xs text-muted-foreground">{pkg.note}</span>}
    </span>
  );
}

export function PackageReceipt({ pkg, onReceipt }: { pkg: Package; onReceipt: (pkg: Package) => void }) {
  if (pkg.document) {
    return (
      <Link
        to="/receipts/$id"
        params={{ id: pkg.document.documentId }}
        className="text-sm underline-offset-4 hover:underline"
      >
        {pkg.document.number ?? "Draft"}
      </Link>
    );
  }
  if (pkg.removed) return null;
  return (
    <Button variant="outline" size="xs" onClick={() => onReceipt(pkg)}>
      Receipt
    </Button>
  );
}

/** Calendar packages are changed in the calendar; only app ones are editable here. */
export function PackageMenu({ pkg, handlers }: { pkg: Package; handlers: PackageHandlers }) {
  if (pkg.source !== "app" || pkg.document) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Actions" />}>
        <MoreHorizontalIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto">
        <DropdownMenuItem onClick={() => handlers.onEdit(pkg)}>Edit</DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onClick={() => handlers.onDelete(pkg)}>
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
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
      cell: ({ getValue }) => formatDate(getValue()),
    }),
    helper.accessor((pkg) => creditsLeft(pkg), {
      id: "credits",
      header: "Credits",
      sortFn: "basic",
      cell: ({ row }) => <PackageCredits pkg={row.original} />,
    }),
    helper.accessor("priceCents", {
      header: "Price",
      sortFn: "basic",
      cell: ({ row }) => <PackagePrice pkg={row.original} />,
    }),
    helper.display({
      id: "source",
      header: "From",
      cell: ({ row }) => <PackageSource pkg={row.original} />,
    }),
    helper.display({
      id: "receipt",
      header: "Receipt",
      cell: ({ row }) => <PackageReceipt pkg={row.original} onReceipt={handlers.onReceipt} />,
    }),
    helper.display({
      id: "actions",
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row }) => <PackageMenu pkg={row.original} handlers={handlers} />,
    }),
  ]);
}
