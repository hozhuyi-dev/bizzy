import { useMemo, useState } from "react";
import { useTable } from "@tanstack/react-table";
import { PlusIcon } from "lucide-react";
import { toast } from "sonner";
import { DeletePackageDialog } from "./components/delete-package-dialog/delete-package-dialog.component";
import { PackageForm } from "./components/package-form/package-form.component";
import { PackageCard, createPackageColumns } from "./packages.columns";
import { PACKAGE_PRESETS, clientName, matchesPackage, packageFacets, packagePayables } from "./packages.util";
import { PackagesMutation } from "./packages.mutation";
import { PackagesQuery } from "./packages.query";
import type { PackageHandlers } from "./packages.columns";
import type { PackageView } from "./packages.types";
import type { DocumentSource } from "~/features/documents/documents.types";
import type { ListFilter } from "~/core/list/filter.types";
import { ClientsQuery } from "~/features/clients/clients.query";
import { useWhatsAppMenu } from "~/features/whatsapp/whatsapp.hook";
import { useSettleReturn } from "~/features/remedies/settle.hook";
import { PaymentPanel } from "~/features/payments/components/payment-panel/payment-panel.component";
import { toastRefusal } from "~/features/remedies/components/remedy-buttons/remedy-buttons.component";
import { DataTable } from "~/components/shared/list/data-table/data-table.component";
import { dataTableFeatures } from "~/components/shared/list/data-table/data-table.config";
import { sortingFromFilter } from "~/components/shared/list/data-table/data-table-sort.util";
import { PageHeader } from "~/components/shared/layout/page-header/page-header.component";
import { FilterBar } from "~/components/shared/list/filter-bar/filter-bar.component";
import { EmptyState } from "~/components/shared/feedback/empty-state/empty-state.component";
import { SheetDialog } from "~/components/shared/dialog/sheet-dialog/sheet-dialog.component";
import { DialogDescription, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { formatDate, formatHours } from "~/core/utils/date.util";
import { allOf } from "~/core/utils/query.util";
import { QUIPS } from "~/core/constants/quips.constant";

/** How packages sort until a column is picked: latest bought first, as every dated list. */
const LATEST_FIRST = [{ id: "purchasedAt", desc: true }];

type Editing = { mode: "new"; clientId?: string | undefined } | { mode: "edit"; pkg: PackageView } | null;

// Stable fallback: a fresh [] each render would rebuild the row models.
const NO_PACKAGES: Array<PackageView> = [];

interface PackagesPageProps {
  /** Words, days bought, and chips: Open (by default), clients, and how far their documents have got. */
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
 * the search, days and chips filter here, in the browser.
 */
export function PackagesPage({ filter, onFilterChange, newFor, settle }: PackagesPageProps) {
  const [editing, setEditing] = useState<Editing>(newFor || settle ? { mode: "new", clientId: newFor } : null);
  const settled = useSettleReturn(settle);
  const [deleting, setDeleting] = useState<PackageView | null>(null);
  const [payingId, setPayingId] = useState<string>();
  // Every package, as sessions and clients read them: one cached read, filtered here.
  const packages = PackagesQuery.useList(true);
  const clients = ClientsQuery.useList();
  const clientsById = ClientsQuery.useById();
  const facets = useMemo(() => packageFacets(clients.data ?? []), [clients.data]);
  // Routes make a new filter each render: its days and chips, as text, say when it changed.
  const narrowing = JSON.stringify([filter.when, filter.chips]);
  const rows = useMemo(() => {
    const all = packages.data ?? NO_PACKAGES;
    const [when, chips] = JSON.parse(narrowing) as [string | undefined, ListFilter["chips"]];
    return all.filter((pkg) => matchesPackage(pkg, { text: "", when, chips }));
  }, [packages.data, narrowing]);
  const makeStandalone = PackagesMutation.useMakeStandalone();
  const whatsappMenu = useWhatsAppMenu();
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
      whatsapp: (pkg) => {
        const items: Array<DocumentSource> = [{ kind: "package", id: pkg.id }];
        return whatsappMenu({
          to: { name: clientName(pkg, clientsById), phone: clientsById.get(pkg.clientId)?.contact?.phone },
          askToPay: { request: { items }, can: pkg.can.askToPay },
          sendRecords: { items, can: pkg.can.sendRecords },
          openChat: true,
        });
      },
    }),
    [clientsById, makeStandalone, whatsappMenu],
  );

  const columns = useMemo(() => createPackageColumns(handlers), [handlers]);

  const table = useTable({
    features: dataTableFeatures,
    columns,
    data: rows,
    getRowId: (pkg) => pkg.id,
    ...sortingFromFilter(filter, onFilterChange, LATEST_FIRST, columns),
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
        toolbar={
          <FilterBar
            label="Search packages"
            value={filter}
            onChange={onFilterChange}
            facets={facets}
            presets={PACKAGE_PRESETS}
            dates
          />
        }
      />

      <DataTable
            table={table}
            source={allOf(packages, clients)}
            query={filter.text}
            onRowOpen={handlers.onEdit}
            empty={
              <EmptyState quips={QUIPS.packages}>
                No packages. Write 10x85 or 10@850 after a name in the calendar, or add one here.
              </EmptyState>
            }
            renderCard={(row) => <PackageCard pkg={row.original} handlers={handlers} />}
      />

      <SheetDialog open={editing !== null} onClose={() => setEditing(null)}>
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
      </SheetDialog>

      <SheetDialog open={paying !== undefined} onClose={() => setPayingId(undefined)}>
        <DialogHeader>
          <DialogTitle>Package payment</DialogTitle>
          {paying && (
            <DialogDescription>
              {clientName(paying, clientsById)} · {formatHours(paying.hours)}, bought {formatDate(paying.purchasedAt)}
            </DialogDescription>
          )}
        </DialogHeader>
        {paying && <PaymentPanel payables={packagePayables(paying)} onCancel={() => setPayingId(undefined)} />}
      </SheetDialog>

      <DeletePackageDialog
        pkg={deleting}
        clientName={deleting ? clientName(deleting, clientsById) : ""}
        onClose={() => setDeleting(null)}
      />
    </>
  );
}
