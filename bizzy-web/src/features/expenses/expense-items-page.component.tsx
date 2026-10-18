import { useMemo, useState } from "react";
import { useTable } from "@tanstack/react-table";
import { PencilIcon } from "lucide-react";
import { toast } from "sonner";
import { ExpensesMutation } from "./expenses.mutation";
import { ExpensesQuery } from "./expenses.query";
import type { CatalogueView, ExpenseItem } from "./expenses.types";
import { DataTable } from "~/components/shared/data-table/data-table.component";
import { createDataTableColumnHelper, dataTableFeatures } from "~/components/shared/data-table/data-table.config";
import { PageHeader } from "~/components/shared/page-header/page-header.component";
import { EmptyState, Loading } from "~/components/shared/quip/quip.component";
import { RowActionButtons, RowActionMenu } from "~/components/shared/row-actions/row-actions.component";
import { SearchInput } from "~/components/shared/search-input/search-input.component";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Checkbox } from "~/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { formatCents } from "~/core/utils/money.util";
import { QUIPS } from "~/core/constants/quips.constant";

const NO_ITEMS: Array<ExpenseItem> = [];

const helper = createDataTableColumnHelper<ExpenseItem>();

/**
 * The things she buys, which lines are picked from. Items are added as she
 * types new ones on an expense; here they are renamed, moved to another
 * category for lines from now on, or archived.
 */
export function ExpenseItemsPage() {
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<ExpenseItem | null>(null);
  const catalogue = ExpensesQuery.useCatalogue();
  const categoryName = useMemo(() => {
    const names = new Map((catalogue.data?.categories ?? []).map((c) => [c.id, c.name]));
    return (item: ExpenseItem) => names.get(item.categoryId) ?? "—";
  }, [catalogue.data]);

  const columns = useMemo(
    () =>
      helper.columns([
        helper.accessor("name", {
          header: "Item",
          sortFn: "alphanumeric",
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
          cell: ({ getValue }) => {
            const cents = getValue();
            return cents === undefined ? "—" : formatCents(cents);
          },
        }),
        helper.display({
          id: "actions",
          cell: ({ row }) => (
            <RowActionButtons actions={[{ label: "Edit", icon: PencilIcon, onClick: () => setEditing(row.original) }]} />
          ),
        }),
      ]),
    [categoryName],
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
      {catalogue.isPending ? (
        <Loading />
      ) : catalogue.error ? (
        <p role="alert" className="text-sm text-destructive">
          {catalogue.error.message}
        </p>
      ) : (
        <DataTable
          table={table}
          query={search}
          empty={<EmptyState quips={QUIPS.expenses}>No items yet. They're added as you record expenses.</EmptyState>}
          renderCard={(row) => (
            <Card size="sm">
              <CardContent className="flex items-start justify-between gap-2">
                <span className="flex flex-col">
                  <span className="font-medium">{row.original.name}</span>
                  <span className="text-xs text-muted-foreground">{categoryName(row.original)}</span>
                </span>
                <RowActionMenu actions={[{ label: "Edit", icon: PencilIcon, onClick: () => setEditing(row.original) }]} />
              </CardContent>
            </Card>
          )}
        />
      )}

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          {editing && catalogue.data && (
            <ItemForm key={editing.id} item={editing} catalogue={catalogue.data} onDone={() => setEditing(null)} />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function ItemForm({ item, catalogue, onDone }: { item: ExpenseItem; catalogue: CatalogueView; onDone: () => void }) {
  const save = ExpensesMutation.useSaveItem();
  const [values, setValues] = useState(item);
  const categories = catalogue.categories.filter((c) => !c.archived || c.id === item.categoryId);

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate(values, {
          onSuccess: () => {
            toast.success("Item saved");
            onDone();
          },
          onError: (error) => toast.error(error.message),
        });
      }}
    >
      <DialogHeader>
        <DialogTitle>Edit item</DialogTitle>
        <DialogDescription>Expenses already recorded keep the name and category they were saved with.</DialogDescription>
      </DialogHeader>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="item-name">Name</FieldLabel>
          <Input
            id="item-name"
            value={values.name}
            maxLength={100}
            onChange={(e) => setValues({ ...values, name: e.target.value })}
          />
        </Field>
        <Field>
          <FieldLabel>Category</FieldLabel>
          <Select
            items={categories.map((c) => ({ value: c.id, label: c.name }))}
            value={values.categoryId}
            onValueChange={(value) => setValues({ ...values, categoryId: value ?? values.categoryId })}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field orientation="horizontal">
          <Checkbox
            id="item-archived"
            checked={values.archived ?? false}
            onCheckedChange={(checked) => setValues({ ...values, archived: checked })}
          />
          <FieldContent>
            <FieldLabel htmlFor="item-archived">Archived</FieldLabel>
            <FieldDescription>Not suggested on new expenses. Expenses already recorded keep it.</FieldDescription>
          </FieldContent>
        </Field>
      </FieldGroup>
      <DialogFooter>
        <Button type="submit" disabled={save.isPending || !values.name.trim()}>
          {save.isPending ? "Saving…" : "Save"}
        </Button>
      </DialogFooter>
    </form>
  );
}
