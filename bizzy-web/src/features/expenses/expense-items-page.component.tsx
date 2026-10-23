import { useCallback, useMemo, useState } from "react";
import { useTable } from "@tanstack/react-table";
import { PencilIcon } from "lucide-react";
import { toast } from "sonner";
import { ExpensesMutation } from "./expenses.mutation";
import { ExpensesQuery } from "./expenses.query";
import type { CatalogueView, ExpenseItem } from "./expenses.types";
import type { Action } from "~/components/shared/actions/action-bar/action-bar.types";
import { DataTable } from "~/components/shared/list/data-table/data-table.component";
import { createDataTableColumnHelper, dataTableFeatures } from "~/components/shared/list/data-table/data-table.config";
import { PageHeader } from "~/components/shared/layout/page-header/page-header.component";
import { EmptyState } from "~/components/shared/feedback/empty-state/empty-state.component";
import { RowActions } from "~/components/shared/actions/row-actions/row-actions.component";
import { CellEmpty } from "~/components/shared/list/data-table/data-table-cell.component";
import { DataCard } from "~/components/shared/list/data-card/data-card.component";
import { SearchInput } from "~/components/shared/list/search-input/search-input.component";
import { SheetDialog } from "~/components/shared/dialog/sheet-dialog/sheet-dialog.component";
import { Badge } from "~/components/ui/badge";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { FieldGroup } from "~/components/ui/field";
import { useAppForm } from "~/components/shared/form/form.hook";
import { requiredError } from "~/core/utils/form.util";
import { formatCents } from "~/core/utils/money.util";
import { QUIPS } from "~/core/constants/quips.constant";
import { toastRefusal } from "~/features/remedies/components/remedy-buttons/remedy-buttons.component";

/** As the API keeps an item's name. */
const MAX_NAME = 100;

const NO_ITEMS: Array<ExpenseItem> = [];

const helper = createDataTableColumnHelper<ExpenseItem>();

/**
 * The things the user buys, which lines are picked from. Items are added
 * as new ones are typed on an expense; here they are renamed, moved to
 * another category for lines from now on, or archived.
 */
export function ExpenseItemsPage() {
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<ExpenseItem | null>(null);
  const catalogue = ExpensesQuery.useCatalogue();
  const categoryName = useMemo(() => {
    const names = new Map((catalogue.data?.categories ?? []).map((c) => [c.id, c.name]));
    return (item: ExpenseItem) => names.get(item.categoryId) ?? "—";
  }, [catalogue.data]);
  // A click on the row opens it to edit; Edit is its one action, for the keyboard.
  const itemActions = useCallback(
    (item: ExpenseItem): Array<Action> => [
      { type: "button", label: "Edit", icon: PencilIcon, onClick: () => setEditing(item) },
    ],
    [],
  );

  const columns = useMemo(
    () =>
      helper.columns([
        helper.accessor("name", {
          header: "Item",
          sortFn: "alphanumeric",
          meta: { width: "grow" },
          cell: ({ row }) => (
            <span className="flex flex-wrap items-center gap-1.5">
              {row.original.name}
              {row.original.archived && <Badge variant="neutral">Archived</Badge>}
            </span>
          ),
        }),
        helper.accessor((item) => categoryName(item), { id: "category", header: "Category", sortFn: "alphanumeric" }),
        helper.accessor((item) => item.lastAmountCents, {
          id: "last",
          header: "Last paid",
          sortFn: "basic",
          sortUndefined: "last",
          meta: { align: "end" },
          cell: ({ getValue }) => {
            const cents = getValue();
            return cents === undefined ? <CellEmpty /> : formatCents(cents);
          },
        }),
        helper.display({
          id: "actions",
          header: () => <span className="sr-only">Actions</span>,
          meta: { width: "fit" },
          cell: ({ row }) => (
            <RowActions actions={itemActions(row.original)} />
          ),
        }),
      ]),
    [categoryName, itemActions],
  );

  const table = useTable({
    features: dataTableFeatures,
    columns,
    data: catalogue.data?.items ?? NO_ITEMS,
    getRowId: (item) => item.id,
    initialState: { sorting: [{ id: "name", desc: false }] },
  });

  return (
    <>
      <PageHeader title="Items" toolbar={<SearchInput label="Search items" value={search} onChange={setSearch} />} />
      <DataTable
          table={table}
          source={catalogue}
          query={search}
          onRowOpen={setEditing}
          empty={<EmptyState quips={QUIPS.expenses}>No items yet. They're added as you record expenses.</EmptyState>}
          renderCard={(row) => (
            <DataCard
              title={
                <>
                  <span className="font-medium">{row.original.name}</span>
                  {row.original.archived && <Badge variant="neutral">Archived</Badge>}
                </>
              }
              value={row.original.lastAmountCents === undefined ? undefined : formatCents(row.original.lastAmountCents)}
              meta={categoryName(row.original)}
              actions={itemActions(row.original)}
              onOpen={() => setEditing(row.original)}
            />
          )}
        />

      <SheetDialog open={editing !== null} onClose={() => setEditing(null)}>
        {editing && catalogue.data && (
          <ItemForm key={editing.id} item={editing} catalogue={catalogue.data} onDone={() => setEditing(null)} />
        )}
      </SheetDialog>
    </>
  );
}

function ItemForm({ item, catalogue, onDone }: { item: ExpenseItem; catalogue: CatalogueView; onDone: () => void }) {
  const save = ExpensesMutation.useSaveItem();
  const all = catalogue.categories.map((c) => ({ value: c.id, label: c.name }));
  const offered = catalogue.categories
    .filter((c) => !c.archived || c.id === item.categoryId)
    .map((c) => ({ value: c.id, label: c.name }));

  const form = useAppForm({
    defaultValues: { ...item, archived: item.archived ?? false },
    onSubmit: async ({ value }) => {
      try {
        await save.mutateAsync(value);
        toast.success("Item saved");
        onDone();
      } catch (error) {
        toastRefusal(error);
      }
    },
  });

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <DialogHeader>
        <DialogTitle>Edit item</DialogTitle>
        <DialogDescription>Expenses already recorded keep the name and category they were saved with.</DialogDescription>
      </DialogHeader>
      <FieldGroup>
        <form.AppField name="name" validators={{ onChange: ({ value }) => requiredError(value, "Name the item") }}>
          {(field) => <field.TextField label="Name" maxLength={MAX_NAME} />}
        </form.AppField>
        <form.AppField name="categoryId" validators={{ onChange: ({ value }) => requiredError(value, "Choose a category") }}>
          {(field) => <field.SelectField label="Category" items={all} options={offered} />}
        </form.AppField>
        <form.AppField name="archived">
          {(field) => (
            <field.CheckboxField
              label="Archived"
              description="Not suggested on new expenses. Expenses already recorded keep it."
            />
          )}
        </form.AppField>
      </FieldGroup>
      <DialogFooter>
        <form.AppForm>
          <form.SubmitButton label="Save" />
        </form.AppForm>
      </DialogFooter>
    </form>
  );
}
