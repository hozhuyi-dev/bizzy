import { useMemo, useState } from "react";
import { useTable } from "@tanstack/react-table";
import { PlusIcon } from "lucide-react";
import { toast } from "sonner";
import { PackageForm } from "./components/package-form/package-form.component";
import {
  PackageCredits,
  PackageDocuments,
  PackagePayment,
  PackagePrice,
  PackageSource,
  clientName,
  createPackageColumns,
  packageActions,
} from "./packages.columns";
import { PackagesMutation, PackagesQuery } from "./packages.query";
import type { PackageHandlers } from "./packages.columns";
import type { Package } from "./packages.types";
import { ClientsQuery } from "~/features/clients/clients.query";
import { PaymentPanel } from "~/features/payments/components/payment-panel/payment-panel.component";
import { useCreateDocument } from "~/features/documents/use-create-document";
import { DataTable } from "~/components/shared/data-table/data-table.component";
import { dataTableFeatures } from "~/components/shared/data-table/data-table.features";
import { PageHeader } from "~/components/shared/page-header/page-header.component";
import { SearchInput } from "~/components/shared/search-input/search-input.component";
import { EmptyState, Loading } from "~/components/shared/quip/quip.component";
import { RowActionMenu } from "~/components/shared/row-actions/row-actions.component";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { formatDate } from "~/core/utils/date.util";
import { formatCents } from "~/core/utils/money.util";
import { queryMatch } from "~/core/utils/query.util";
import { QUIPS } from "~/core/constants/quips.constant";

type Editing = { mode: "new" } | { mode: "edit"; pkg: Package } | null;
export type PackagesView = "open" | "all";

// Stable fallback: a fresh [] each render would rebuild the row models.
const NO_PACKAGES: Array<Package> = [];

interface PackagesPageProps {
  view: PackagesView;
  onViewChange: (view: PackagesView) => void;
}

/** Prepaid packages with the credits each has left, and whether each is paid. */
export function PackagesPage({ view, onViewChange }: PackagesPageProps) {
  const [editing, setEditing] = useState<Editing>(null);
  const [deleting, setDeleting] = useState<Package | null>(null);
  const [payingId, setPayingId] = useState<string>();
  const [search, setSearch] = useState("");
  const packages = PackagesQuery.useList(view === "all");
  const clientsById = ClientsQuery.useById();
  const remove = PackagesMutation.useDelete();
  const { create: createDocument } = useCreateDocument();
  // Read from the list, so the dialog shows the payment once it is saved.
  const paying = packages.data?.find((pkg) => pkg.id === payingId);

  const handlers = useMemo<PackageHandlers>(
    () => ({
      clientsById,
      onEdit: (pkg) => setEditing({ mode: "edit", pkg }),
      onDelete: setDeleting,
      onPay: (pkg) => setPayingId(pkg.id),
      onDocument: (type, pkg) => createDocument(type, [{ kind: "package", id: pkg.id }]),
    }),
    [clientsById, createDocument],
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
            <Tabs value={view} onValueChange={(value) => onViewChange(value as PackagesView)}>
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
            <PaymentPanel
              payables={[
                {
                  item: { kind: "package", id: paying.id },
                  label: `Package of ${paying.sessions}`,
                  dueCents: paying.priceCents,
                  payment: paying.payment,
                  receipted: Boolean(paying.receipt),
                },
              ]}
            />
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this package?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting && (
                <>
                  {clientName(deleting, clientsById)}, {deleting.sessions} sessions for {formatCents(deleting.priceCents)}.
                  {deleting.payment?.status === "paid" &&
                    ` The ${formatCents(deleting.payment.amountCents)} she paid for it comes off your income.`}{" "}
                  Sessions on its credits go back to their usual fee. This can't be undone.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() =>
                deleting &&
                remove.mutate(deleting.id, {
                  onSuccess: () => {
                    toast.success("Package deleted");
                    setDeleting(null);
                  },
                  onError: (error) => toast.error(error.message),
                })
              }
            >
              Delete
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
