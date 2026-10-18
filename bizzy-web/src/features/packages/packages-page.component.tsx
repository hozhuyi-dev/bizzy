import { useMemo, useState } from "react";
import { useTable } from "@tanstack/react-table";
import { PlusIcon } from "lucide-react";
import { toast } from "sonner";
import { DeletePackageDialog } from "./components/delete-package-dialog/delete-package-dialog.component";
import { PackageForm } from "./components/package-form/package-form.component";
import { PackageCredits, PackageDocuments, PackagePayment, PackagePrice, PackageSource, createPackageColumns, packageActions } from "./packages.columns";
import { clientName, packagePayables } from "./packages.util";
import { PackagesMutation } from "./packages.mutation";
import { PackagesQuery } from "./packages.query";
import type { PackageHandlers } from "./packages.columns";
import type { PackageView, PackagesFilter } from "./packages.types";
import { ClientsQuery } from "~/features/clients/clients.query";
import { PaymentPanel } from "~/features/payments/components/payment-panel/payment-panel.component";
import { toastRefusal } from "~/features/remedies/components/remedy-buttons/remedy-buttons.component";
import { DataTable } from "~/components/shared/data-table/data-table.component";
import { dataTableFeatures } from "~/components/shared/data-table/data-table.config";
import { PageHeader } from "~/components/shared/page-header/page-header.component";
import { SearchInput } from "~/components/shared/search-input/search-input.component";
import { EmptyState, Loading } from "~/components/shared/quip/quip.component";
import { RowActionMenu } from "~/components/shared/row-actions/row-actions.component";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { formatDate } from "~/core/utils/date.util";
import { formatCents } from "~/core/utils/money.util";
import { queryMatch } from "~/core/utils/query.util";
import { QUIPS } from "~/core/constants/quips.constant";

type Editing = { mode: "new" } | { mode: "edit"; pkg: PackageView } | null;

// Stable fallback: a fresh [] each render would rebuild the row models.
const NO_PACKAGES: Array<PackageView> = [];

interface PackagesPageProps {
  view: PackagesFilter;
  onViewChange: (view: PackagesFilter) => void;
}

/** Prepaid packages with the credits each has left, and whether each is paid. */
export function PackagesPage({ view, onViewChange }: PackagesPageProps) {
  const [editing, setEditing] = useState<Editing>(null);
  const [deleting, setDeleting] = useState<PackageView | null>(null);
  const [payingId, setPayingId] = useState<string>();
  const [search, setSearch] = useState("");
  const packages = PackagesQuery.useList(view === "all");
  const clientsById = ClientsQuery.useById();
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
    data: packages.data ?? NO_PACKAGES,
    getRowId: (pkg) => pkg.id,
    initialState: { sorting: [{ id: "client", desc: false }] },
  });

  return (
    <>
      <PageHeader
        title="Packages"
        actions={
          <Button onClick={() => setEditing({ mode: "new" })}>
            <PlusIcon /> New package
          </Button>
        }
        toolbar={
          <>
            <Tabs value={view} onValueChange={(value) => onViewChange(value as PackagesFilter)}>
              <TabsList>
                <TabsTrigger value="open">Open</TabsTrigger>
                <TabsTrigger value="all">All</TabsTrigger>
              </TabsList>
            </Tabs>
            <SearchInput label="Search packages" value={search} onChange={setSearch} />
          </>
        }
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
            query={search}
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
              onDone={() => setEditing(null)}
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
                {clientName(paying, clientsById)} · {paying.sessions} sessions, bought {formatDate(paying.purchasedAt)}
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
