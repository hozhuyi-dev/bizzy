import { useState } from "react";
import { ArrowDownIcon, ArrowUpIcon, PlusIcon } from "lucide-react";
import { toast } from "sonner";
import { ExpensesMutation } from "./expenses.mutation";
import { ExpensesQuery } from "./expenses.query";
import type { ExpenseCategory } from "./expenses.types";
import { PageHeader } from "~/components/shared/page-header/page-header.component";
import { Loading } from "~/components/shared/quip/quip.component";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Field, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";

/**
 * The categories items are filed under. They start as the expenses on LHDN's
 * Form B, so a year's totals are what the tax return asks for; should the
 * form change, they are renamed, added or archived here. One is never
 * deleted: expenses already recorded are filed under it.
 */
export function ExpenseCategoriesPage() {
  const catalogue = ExpensesQuery.useCatalogue();
  if (catalogue.isPending) {
    return (
      <>
        <PageHeader title="Categories" />
        <Loading />
      </>
    );
  }
  if (catalogue.error) {
    return (
      <>
        <PageHeader title="Categories" />
        <p role="alert" className="text-sm text-destructive">
          {catalogue.error.message}
        </p>
      </>
    );
  }
  return <CategoriesEditor initial={catalogue.data.categories} />;
}

function CategoriesEditor({ initial }: { initial: Array<ExpenseCategory> }) {
  const save = ExpensesMutation.useSaveCategories();
  const [categories, setCategories] = useState(initial);

  const update = (i: number, change: Partial<ExpenseCategory>) =>
    setCategories(categories.map((category, j) => (j === i ? { ...category, ...change } : category)));
  const move = (i: number, by: number) => {
    const next = [...categories];
    const [moved] = next.splice(i, 1);
    if (moved) next.splice(i + by, 0, moved);
    setCategories(next);
  };

  return (
    <>
      <PageHeader
        title="Categories"
        actions={[
          {
            type: "button",
            label: save.isPending ? "Saving…" : "Save",
            style: "primary",
            disabled: save.isPending,
            onClick: () =>
              save.mutate(categories, {
                onSuccess: (saved) => {
                  setCategories(saved);
                  toast.success("Categories saved");
                },
                onError: (error) => toast.error(error.message),
              }),
          },
        ]}
      />
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          These follow the business expenses on LHDN&apos;s Form B, so a year&apos;s totals are what the tax return
          asks for. If the form changes, rename them or add new ones. Archive one you no longer use: what is already
          filed under it stays there.
        </p>
        <ul className="flex flex-col divide-y rounded-md border">
          {categories.map((category, i) => (
            <li key={category.id ?? `new-${i}`} className="flex flex-col gap-2 p-3 md:flex-row md:items-start">
              <div className="grid flex-1 gap-2 md:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor={`category-${i}-name`} className="sr-only">
                    Name
                  </FieldLabel>
                  <Input
                    id={`category-${i}-name`}
                    value={category.name}
                    maxLength={100}
                    onChange={(e) => update(i, { name: e.target.value })}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor={`category-${i}-hint`} className="sr-only">
                    What goes in it
                  </FieldLabel>
                  <Input
                    id={`category-${i}-hint`}
                    value={category.hint ?? ""}
                    maxLength={200}
                    placeholder="What goes in it"
                    onChange={(e) => update(i, { hint: e.target.value })}
                  />
                </Field>
              </div>
              <div className="flex flex-wrap items-center gap-3 md:h-8">
                <label className="flex items-center gap-1.5 text-sm">
                  <Checkbox checked={category.capital ?? false} onCheckedChange={(checked) => update(i, { capital: checked })} />
                  Capital allowance
                </label>
                <label className="flex items-center gap-1.5 text-sm">
                  <Checkbox
                    checked={category.archived ?? false}
                    onCheckedChange={(checked) => update(i, { archived: checked })}
                  />
                  Archived
                </label>
                <span className="flex">
                  <Button variant="ghost" size="icon-sm" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                    <ArrowUpIcon />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Move down"
                    disabled={i === categories.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    <ArrowDownIcon />
                  </Button>
                </span>
              </div>
            </li>
          ))}
        </ul>
        <Button
          variant="outline"
          size="sm"
          className="w-fit"
          onClick={() => setCategories([...categories, { name: "", hint: "" }])}
        >
          <PlusIcon /> Add category
        </Button>
      </div>
    </>
  );
}
