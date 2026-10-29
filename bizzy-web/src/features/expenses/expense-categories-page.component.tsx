import { useSelector } from "@tanstack/react-form";
import { ArrowDownIcon, ArrowUpIcon, ChevronRightIcon, PlusIcon } from "lucide-react";
import { toast } from "sonner";
import { ExpensesMutation } from "./expenses.mutation";
import { ExpensesQuery } from "./expenses.query";
import type { ExpenseCategory } from "./expenses.types";
import { PageHeader } from "~/components/shared/layout/page-header/page-header.component";
import { LoadingState } from "~/components/shared/feedback/loading-state/loading-state.component";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { useAppForm } from "~/components/shared/form/form.hook";
import { UnsavedChangesDialog } from "~/components/shared/dialog/unsaved-changes-dialog/unsaved-changes-dialog.component";
import { requiredError } from "~/core/utils/form.util";
import { toastRefusal } from "~/features/remedies/components/remedy-buttons/remedy-buttons.component";
import { ErrorState } from "~/components/shared/feedback/error-state/error-state.component";

/**
 * The categories items are filed under. They start as the expenses on LHDN's
 * Form B, so a year's totals are what the tax return asks for; should the
 * form change, they are renamed, added or archived here. One is never
 * deleted: expenses already recorded are filed under it. The archived ones
 * are folded away at the bottom, as put away elsewhere.
 */
export function ExpenseCategoriesPage() {
  const catalogue = ExpensesQuery.useCatalogue();
  if (catalogue.data) return <CategoriesEditor initial={catalogue.data.categories} />;
  return (
    <>
      <PageHeader title="Categories" />
      {catalogue.error ? (
        <ErrorState error={catalogue.error} retry={catalogue.refetch} size="page" />
      ) : (
        <LoadingState shape="page" />
      )}
    </>
  );
}

const FORM_ID = "categories-form";

// As the API keeps them.
const MAX_NAME = 100;
const MAX_HINT = 200;

/** A category as the form edits it: every field filled, so each input has a value. */
type CategoryValues = ExpenseCategory & { hint: string; capital: boolean; archived: boolean };

function toCategoryValues(categories: ReadonlyArray<ExpenseCategory>): Array<CategoryValues> {
  return categories.map((category) => ({
    ...category,
    hint: category.hint ?? "",
    capital: category.capital ?? false,
    archived: category.archived ?? false,
  }));
}

function CategoriesEditor({ initial }: { initial: Array<ExpenseCategory> }) {
  const save = ExpensesMutation.useSaveCategories();

  const form = useAppForm({
    defaultValues: { categories: toCategoryValues(initial) },
    onSubmit: async ({ formApi, value }) => {
      try {
        const saved = await save.mutateAsync(value.categories);
        // The saved list, with ids for the new ones, is the one to change from now.
        formApi.reset({ categories: toCategoryValues(saved) });
        toast.success("Categories saved");
      } catch (error) {
        toastRefusal(error);
      }
    },
  });

  const isSubmitting = useSelector(form.store, (state) => state.isSubmitting);
  const hasChanges = useSelector(form.store, (state) => !state.isDefaultValue);
  // Grouped as saved, so ticking Archived doesn't move the row away from under the pointer.
  const archivedIds = new Set(initial.flatMap((category) => (category.archived && category.id ? [category.id] : [])));

  return (
    <>
      <PageHeader
        title="Categories"
        actions={[
          {
            type: "submit",
            form: FORM_ID,
            label: "Save",
            style: "primary",
            pending: isSubmitting,
          },
        ]}
      />
      <form
        id={FORM_ID}
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <p className="text-sm text-muted-foreground">
          These follow the business expenses on LHDN&apos;s Form B, so a year&apos;s totals are what the tax return
          asks for. If the form changes, rename them or add new ones. Archive one you no longer use: what is already
          filed under it stays there.
        </p>
        <form.Field name="categories" mode="array">
          {(list) => {
            const rows = list.state.value.map((category, i) => ({ category, i }));
            const archived = rows.filter(({ category }) => category.id !== undefined && archivedIds.has(category.id));
            const inUse = rows.filter((row) => !archived.includes(row));
            const row = ({ category, i }: { category: CategoryValues; i: number }) => (
              <li key={category.id ?? `new-${i}`} className="flex flex-col gap-2 p-3 md:flex-row md:items-start">
                <div className="grid flex-1 gap-2 md:grid-cols-2">
                  <form.AppField
                    name={`categories[${i}].name`}
                    validators={{ onChange: ({ value }) => requiredError(value, "Name the category") }}
                  >
                    {(field) => <field.TextField label="Name" labelClassName="sr-only" maxLength={MAX_NAME} />}
                  </form.AppField>
                  <form.AppField name={`categories[${i}].hint`}>
                    {(field) => (
                      <field.TextField
                        label="What goes in it"
                        labelClassName="sr-only"
                        maxLength={MAX_HINT}
                        placeholder="What goes in it"
                      />
                    )}
                  </form.AppField>
                </div>
                <div className="flex flex-wrap items-center gap-3 md:h-8">
                  <form.Field name={`categories[${i}].capital`}>
                    {(field) => (
                      <label className="flex items-center gap-1.5 text-sm">
                        <Checkbox checked={field.state.value} onCheckedChange={(checked) => field.handleChange(checked)} />
                        Capital allowance
                      </label>
                    )}
                  </form.Field>
                  <form.Field name={`categories[${i}].archived`}>
                    {(field) => (
                      <label className="flex items-center gap-1.5 text-sm">
                        <Checkbox checked={field.state.value} onCheckedChange={(checked) => field.handleChange(checked)} />
                        Archived
                      </label>
                    )}
                  </form.Field>
                  <span className="flex">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Move up"
                      disabled={i === 0}
                      onClick={() => list.moveValue(i, i - 1)}
                    >
                      <ArrowUpIcon />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Move down"
                      disabled={i === list.state.value.length - 1}
                      onClick={() => list.moveValue(i, i + 1)}
                    >
                      <ArrowDownIcon />
                    </Button>
                  </span>
                </div>
              </li>
            );
            return (
              <>
                <ul className="flex flex-col divide-y rounded-md border">{inUse.map(row)}</ul>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-fit"
                  onClick={() => list.pushValue({ name: "", hint: "", capital: false, archived: false })}
                >
                  <PlusIcon /> Add category
                </Button>
                {archived.length > 0 && (
                  <details className="group/archived">
                    <summary className="flex w-fit cursor-pointer list-none items-center gap-1 text-sm text-muted-foreground">
                      <ChevronRightIcon className="size-4 transition-transform group-open/archived:rotate-90" aria-hidden="true" />
                      Archived ({archived.length})
                    </summary>
                    <ul className="mt-2 flex flex-col divide-y rounded-md border">{archived.map(row)}</ul>
                  </details>
                )}
              </>
            );
          }}
        </form.Field>
      </form>
      <UnsavedChangesDialog when={hasChanges} />
    </>
  );
}
