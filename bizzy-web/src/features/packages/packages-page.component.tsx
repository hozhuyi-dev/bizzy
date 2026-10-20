import { useMemo, useState } from "react";
import { useTable } from "@tanstack/react-table";
import { PlusIcon } from "lucide-react";
import { toast } from "sonner";
import { DeletePackageDialog } from "./components/delete-package-dialog/delete-package-dialog.component";
import { PackageForm } from "./components/package-form/package-form.component";
import { PackageCredits, PackageDocuments, PackagePayment, PackagePrice, PackageSource, createPackageColumns, packageActions } from "./packages.columns";
import { clientName, packageFacets, packagePayables, packagesView } from "./packages.util";
import { PackagesMutation } from "./packages.mutation";
import { PackagesQuery } from "./packages.query";
import type { PackageHandlers } from "./packages.columns";
import type { PackageView } from "./packages.types";
import type { ListFilter } from "~/core/filter/filter.types";
import { ClientsQuery } from "~/features/clients/clients.query";
import { useSettleReturn } from "~/features/remedies/settle.hook";
import { PaymentPanel } from "~/features/payments/components/payment-panel/payment-panel.component";
import { toastRefusal } from "~/features/remedies/components/remedy-buttons/remedy-buttons.component";
import { DataTable } from "~/components/shared/data-table/data-table.component";
import { dataTableFeatures } from "~/components/shared/data-table/data-table.config";
import { PageHeader } from "~/components/shared/page-header/page-header.component";
import { FilterBar } from "~/components/shared/filter-bar/filter-bar.component";
import { EmptyState, Loading } from "~/components/shared/quip/quip.component";
import { RowActionMenu } from "~/components/shared/row-actions/row-actions.component";
import { Card, CardContent } from "~/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { formatDate, formatHours } from "~/core/utils/date.util";
import { formatCents } from "~/core/utils/money.util";
import { queryMatch } from "~/core/utils/query.util";
import { QUIPS } from "~/core/constants/quips.constant";

type Editing = { mode: "new"; clientId?: string | undefined } | { mode: "edit"; pkg: PackageView } | null;

// Stable fallback: a fresh [] each render would rebuild the row models.
const NO_PACKAGES: Array<PackageView> = [];

interface PackagesPageProps {
  /** Words, and chips: Open (by default) and clients. */
  filter: ListFilter;
  onFilterChange: (filter: ListFilter) => void;
  /** Opens a new package for this client. */
  newFor?: string | undefined;
  /** The calendar edit it was opened to settle: once the package is added, back to the to-do list. */
  settle?: string | undefined;
}

/**
 * Prepaid packages with the credits each has left, and whether each is
 * paid. Every package is loaded already (sessions show their credits), so
 * the search and chips filter here, in the browser.
 */
export function PackagesPage({ filter, onFilterChange, newFor, settle }: PackagesPageProps) {
  const [editing, setEditing] = useState<Editing>(newFor || settle ? { mode: "new", clientId: newFor } : null);
  const settled = useSettleReturn(settle);
  const [deleting, setDeleting] = useState<PackageView | null>(null);
  const [payingId, setPayingId] = useState<string>();
  const packages = PackagesQuery.useList(packagesView(filter) === "all");
  const clients = ClientsQuery.useList();
  const clientsById = ClientsQuery.useById();
  const facets = useMemo(() => packageFacets(clients.data ?? []), [clients.data]);
  const rows = useMemo(() => {
    const chosen = filter.chips.client ?? [];
    const all = packages.data ?? NO_PACKAGES;
    return chosen.length > 0 ? all.filter((pkg) => chosen.includes(pkg.clientId)) : all;
  }, [packages.data, filter.chips.client]);
  const makeStandalone = PackagesMutation.useMakeStandalone();
  // Read from the list, so the dialog shows the payment once it is saved.
  const paying = packages.data?.find((pkg) => pkg.id === payingId);

  const handlers = useMemo<PackageHandlers>(
    () => ({
      clientsById,
      onEdit: (pkg) => setEditing({ mode: "edit", pkg }),
      onDelete: setDeleting,
      onMakeStandalone: (pkg) =>
        makeStandalone.mutate(pkg.id, {
          onSuccess: () => toast.success("Kept as its own package"),
          onError: toastRefusal,
        }),
      onPay: (pkg) => setPayingId(pkg.id),
    }),
    [clientsById, makeStandalone],
  );

  const columns = useMemo(() => createPackageColumns(handlers), [handlers]);

  const table = useTable({
    features: dataTableFeatures,
    columns,
    data: rows,
    getRowId: (pkg) => pkg.id,
    initialState: { sorting: [{ id: "client", desc: false }] },
  });

  return (
    <>
      <PageHeader
        title="Packages"
        actions={[
          {
            type: "button",
            label: "New package",
            icon: PlusIcon,
            style: "primary",
            onClick: () => setEditing({ mode: "new" }),
          },
        ]}
        toolbar={<FilterBar label="Search packages" value={filter} onChange={onFilterChange} facets={facets} />}
      />

      {queryMatch(packages, {
        pending: () => <Loading />,
        error: (error) => (
          <p role="alert" className="text-sm text-destructive">
            {error.message}
          </p>
        ),
        success: () => (
          <DataTable
            table={table}
            query={filter.text}
            empty={
              <EmptyState quips={QUIPS.packages}>
                No packages. Write 10x85 or 10@850 after a name in the calendar, or add one here.
              </EmptyState>
            }
            renderCard={(row) => (
              <Card size="sm">
                <CardContent className="flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex flex-col">
                      <span className="font-medium">{clientName(row.original, clientsById)}</span>
                      <span className="text-xs text-muted-foreground">
                        Bought {formatDate(row.original.purchasedAt)}
                      </span>
                    </div>
                    <RowActionMenu actions={packageActions(row.original, handlers)} />
                  </div>
                  <div className="flex items-start justify-between gap-2 text-sm">
                    <PackageCredits pkg={row.original} />
                    <PackagePrice pkg={row.original} />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <PackageSource pkg={row.original} />
                    <PackagePayment pkg={row.original} />
                  </div>
                  <PackageDocuments pkg={row.original} empty={null} />
                </CardContent>
              </Card>
            )}
          />
        ),
      })}

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing?.mode === "edit" ? "Edit package" : "New package"}</DialogTitle>
          </DialogHeader>
          {editing && (
            <PackageForm
              key={editing.mode === "edit" ? editing.pkg.id : "new"}
              pkg={editing.mode === "edit" ? editing.pkg : undefined}
              clientId={editing.mode === "new" ? editing.clientId : undefined}
              quiet={editing.mode === "new" && Boolean(settled)}
              onDone={(done) => {
                setEditing(null);
                if (editing.mode === "new") settled?.(done);
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={paying !== undefined} onOpenChange={(open) => !open && setPayingId(undefined)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Package payment</DialogTitle>
            {paying && (
              <DialogDescription>
                {clientName(paying, clientsById)} · {formatHours(paying.hours)}, bought {formatDate(paying.purchasedAt)}
              </DialogDescription>
            )}
          </DialogHeader>
          {paying && (
            <PaymentPanel payables={packagePayables(paying)} />
          )}
        </DialogContent>
      </Dialog>

      <DeletePackageDialog
        pkg={deleting}
        clientName={deleting ? clientName(deleting, clientsById) : ""}
        onClose={() => setDeleting(null)}
      />
    </>
  );
}
