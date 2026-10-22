import { useMemo, useState } from "react";
import { useSelector } from "@tanstack/react-form";
import { useNavigate } from "@tanstack/react-router";
import { CircleAlertIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { EMPTY_LINE, toExpenseFields, toExpenseValues, totalOf, withName } from "./expenses.form";
import { expenseLink } from "./expenses.columns";
import { EXPENSES_LIST } from "./expenses.list";
import { ExpensesMutation } from "./expenses.mutation";
import { ExpensesQuery } from "./expenses.query";
import { expensePlace, expensesUrl, itemSuggestions, vendorSuggestions } from "./expenses.util";
import type { ReactNode } from "react";
import type { CatalogueView, ExpenseView } from "./expenses.types";
import type { PageSection } from "~/components/shared/layout/page-sections/page-sections.component";
import type { ListFilter } from "~/core/list/filter.types";
import { AttachmentList } from "~/features/attachments/components/attachment-list/attachment-list.component";
import { Banner } from "~/components/shared/layout/banner/banner.component";
import { ListPager } from "~/components/shared/list/list-pager/list-pager.component";
import { PageHeader } from "~/components/shared/layout/page-header/page-header.component";
import { LoadingState } from "~/components/shared/feedback/loading-state/loading-state.component";
import { PageSections } from "~/components/shared/layout/page-sections/page-sections.component";
import { UnsavedChangesDialog } from "~/components/shared/dialog/unsaved-changes-dialog/unsaved-changes-dialog.component";
import {
  AlertDialogCancel,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { SheetAlertDialog } from "~/components/shared/dialog/sheet-dialog/sheet-dialog.component";
import { Button } from "~/components/ui/button";
import { FieldGroup } from "~/components/ui/field";
import { formatCents } from "~/core/utils/money.util";
import { moneyError, requiredError } from "~/core/utils/form.util";
import { todayISO } from "~/core/utils/date.util";
import { useAppForm } from "~/components/shared/form/form.hook";
import { toastRefusal } from "~/features/remedies/components/remedy-buttons/remedy-buttons.component";
import { ErrorMessage } from "~/components/shared/feedback/error-message/error-message.component";

const FORM_ID = "expense-form";

// As the API keeps them.
const MAX_VENDOR = 100;
const MAX_NAME = 100;
const MAX_NOTES = 2000;
const MAX_LINES = 50;

/** The expenses list, with the filter it was left at. */
function parentOf(filter: ListFilter | undefined) {
  return { to: "/expenses", label: "Expenses", search: filter ? expensesUrl.toSearch(filter) : {} } as const;
}

/** `filter`: the expenses list an expense's page steps through. */
export type ExpensePageProps =
  | { mode: "new" }
  | { mode: "edit"; id: string; filter: ListFilter; onFilterChange: (filter: ListFilter) => void };

/** The header's way back and, for an expense, its pager: the same while it loads. */
interface ExpenseHeader {
  parent: ReturnType<typeof parentOf>;
  pager?: ReactNode;
}

/** One receipt: where and when, what was on it, and the receipt itself. */
export function ExpensePage(props: ExpensePageProps) {
  const catalogue = ExpensesQuery.useCatalogue();
  const expense = ExpensesQuery.useDetail(props.mode === "edit" ? props.id : undefined);

  const header: ExpenseHeader =
    props.mode === "edit"
      ? {
          parent: parentOf(props.filter),
          pager: (
            <ListPager
              list={EXPENSES_LIST}
              filter={props.filter}
              current={{ id: props.id, place: expense.data && expensePlace(expense.data) }}
              itemLink={(next) => expenseLink(next, expensesUrl.toSearch(props.filter))}
              panel={{
                onApply: props.onFilterChange,
                listLink: (next) => ({ to: "/expenses", search: expensesUrl.toSearch(next) }),
              }}
            />
          ),
        }
      : { parent: parentOf(undefined) };

  const pending = catalogue.isPending || (props.mode === "edit" && expense.isPending);
  const error = catalogue.error ?? (props.mode === "edit" ? expense.error : null);
  if (pending || error || !catalogue.data) {
    return (
      <>
        <PageHeader {...header} title={error ? "Not available" : "…"} />
        {error ? (
          <ErrorMessage>{error.message}</ErrorMessage>
        ) : (
          <LoadingState />
        )}
      </>
    );
  }
  const current = props.mode === "edit" ? expense.data : undefined;
  return (
    <ExpenseEditor key={current?.id ?? "new"} expense={current ?? undefined} catalogue={catalogue.data} header={header} />
  );
}

interface ExpenseEditorProps {
  expense: ExpenseView | undefined;
  catalogue: CatalogueView;
  header: ExpenseHeader;
}

function ExpenseEditor({ expense, catalogue, header }: ExpenseEditorProps) {
  const create = ExpensesMutation.useCreate();
  const update = ExpensesMutation.useUpdate();
  const remove = ExpensesMutation.useDelete();
  const save = expense ? update : create;
  const navigate = useNavigate();
  const [deleting, setDeleting] = useState(false);
  // The form starts from the expense once: attaching a file refetches it,
  // which must not undo what the user is typing. A save moves it on.
  const [defaultValues, setDefaultValues] = useState(() => toExpenseValues(expense));
  const vendors = useMemo(() => vendorSuggestions(catalogue), [catalogue]);
  const items = useMemo(() => itemSuggestions(catalogue), [catalogue]);
  const categories = catalogue.categories.filter((category) => !category.archived);

  const form = useAppForm({
    defaultValues,
    onSubmit: async ({ value, formApi }) => {
      try {
        const fields = toExpenseFields(value);
        if (expense) {
          await update.mutateAsync({ id: expense.id, fields });
          formApi.reset(value);
          setDefaultValues(value);
          toast.success("Expense updated");
        } else {
          const saved = await create.mutateAsync(fields);
          toast.success("Expense saved. Attach the receipt below.");
          void navigate({ to: "/expenses/$id", params: { id: saved.id }, replace: true, ignoreBlocker: true });
        }
      } catch {
        // Shown through save.error.
      }
    },
  });

  const isSubmitting = useSelector(form.store, (state) => state.isSubmitting);
  const hasChanges = useSelector(form.store, (state) => !state.isDefaultValue);
  const categoryItems = catalogue.categories.map((category) => ({ value: category.id, label: category.name }));
  const categoryOptions = categories.map((category) => ({ value: category.id, label: category.name }));

  const sections: Array<PageSection> = [
    {
      id: "receipt",
      title: "Receipt",
      content: (
        <FieldGroup>
          <form.AppField
            name="date"
            validators={{ onChange: ({ value }) => requiredError(value, "Choose the day on the receipt") }}
          >
            {(field) => (
              <field.TextField
                label="Date"
                type="date"
                form={FORM_ID}
                inputClassName="max-w-44"
                // A receipt from a day to come is most likely a typo.
                description={field.state.value > todayISO() ? "That day hasn't come yet." : undefined}
              />
            )}
          </form.AppField>
          <form.AppField name="vendor">
            {(field) => (
              <field.AutocompleteField
                label="Where"
                form={FORM_ID}
                suggestions={vendors}
                maxLength={MAX_VENDOR}
                placeholder="Shopee, the pharmacy, Petronas"
                description="The shop or website it was bought from."
              />
            )}
          </form.AppField>
        </FieldGroup>
      ),
    },
    {
      id: "lines",
      title: "What was bought",
      description: "Pick an item you've bought before, or type a new one and choose its category.",
      content: (
        <form.Field name="lines" mode="array">
          {(linesField) => (
            <div className="flex flex-col gap-3">
              {linesField.state.value.map((_, i) => (
                <div
                  key={i}
                  className="grid items-start gap-2 border-b pb-3 md:grid-cols-[minmax(0,1fr)_minmax(0,14rem)_7rem_auto]"
                >
                  <form.AppField
                    name={`lines[${i}].name`}
                    validators={{ onChange: ({ value }) => requiredError(value, "What was bought?") }}
                    listeners={{
                      // A listed item fills in its category and what it last cost.
                      onChange: ({ value }) =>
                        form.setFieldValue(`lines[${i}]`, (line) => withName(line, value, catalogue)),
                    }}
                  >
                    {(field) => (
                      <field.AutocompleteField
                        label="Item"
                        labelClassName="md:sr-only"
                        form={FORM_ID}
                        suggestions={items}
                        maxLength={MAX_NAME}
                        placeholder="Kinesio tape"
                      />
                    )}
                  </form.AppField>
                  <form.AppField
                    name={`lines[${i}].categoryId`}
                    validators={{ onChange: ({ value }) => requiredError(value, "Choose a category") }}
                  >
                    {(field) => (
                      <field.SelectField
                        label="Category"
                        labelClassName="md:sr-only"
                        placeholder="Category"
                        items={categoryItems}
                        options={categoryOptions}
                      />
                    )}
                  </form.AppField>
                  <form.AppField
                    name={`lines[${i}].amount`}
                    validators={{ onChange: ({ value }) => moneyError(value, { required: "What did it cost?", positive: true }) }}
                  >
                    {(field) => (
                      <field.TextField
                        label="Amount"
                        labelClassName="md:sr-only"
                        form={FORM_ID}
                        inputMode="decimal"
                        inputClassName="text-right"
                        placeholder="0.00"
                      />
                    )}
                  </form.AppField>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Remove line"
                    disabled={linesField.state.value.length === 1}
                    onClick={() => linesField.removeValue(i)}
                  >
                    <Trash2Icon />
                  </Button>
                </div>
              ))}
              <div className="flex items-center justify-between gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={linesField.state.value.length >= MAX_LINES}
                  onClick={() => linesField.pushValue({ ...EMPTY_LINE })}
                >
                  <PlusIcon /> Add line
                </Button>
                <span className="text-sm">
                  Total <b className="text-base tabular-nums">{formatCents(totalOf(linesField.state.value))}</b>
                </span>
              </div>
            </div>
          )}
        </form.Field>
      ),
    },
    {
      id: "files",
      title: "Receipt files",
      description: "A photo of the receipt, or the PDF the shop sent. Keep them for the tax return.",
      content: expense ? (
        <AttachmentList
          owner={{ ownerKind: "expense", ownerId: expense.id }}
          can={{ ok: true }}
          addLabel="Attach the receipt"
        />
      ) : (
        <p className="text-sm text-muted-foreground">Save the expense first, then attach its receipt here.</p>
      ),
    },
    {
      id: "notes",
      title: "Notes",
      content: (
        <form.AppField name="notes">
          {(field) => (
            <field.TextareaField
              label="Notes"
              labelClassName="sr-only"
              form={FORM_ID}
              maxLength={MAX_NOTES}
              placeholder="What it was for, a warranty, who to claim it from…"
            />
          )}
        </form.AppField>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        {...header}
        title={expense ? (expense.vendor ?? "Expense") : "New expense"}
        actions={[
          {
            type: "submit",
            form: FORM_ID,
            label: isSubmitting ? "Saving…" : "Save",
            style: "primary",
            disabled: isSubmitting,
          },
        ]}
        menuActions={
          expense
            ? [{ type: "button", label: "Delete expense", icon: Trash2Icon, style: "destructive", onClick: () => setDeleting(true) }]
            : undefined
        }
        banners={
          save.error && <Banner tone="attention" icon={CircleAlertIcon} title={save.error.message} role="alert" />
        }
      />
      {/* Inputs join this form through their form attribute, so Enter saves. */}
      <form
        id={FORM_ID}
        hidden
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      />
      <PageSections sections={sections} />
      <UnsavedChangesDialog when={hasChanges} />

      <SheetAlertDialog open={deleting} onClose={() => setDeleting(false)}>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this expense?</AlertDialogTitle>
          <AlertDialogDescription>
            {expense && formatCents(expense.totalCents)}
            {expense?.files ? ", with its receipt files" : ""}. This can't be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={remove.isPending}
            onClick={() =>
              expense &&
              remove.mutate(expense.id, {
                onSuccess: () => {
                  toast.success("Expense deleted");
                  void navigate({ ...header.parent, ignoreBlocker: true });
                },
                onError: toastRefusal,
                onSettled: () => setDeleting(false),
              })
            }
          >
            {remove.isPending ? "Deleting…" : "Delete"}
          </Button>
        </AlertDialogFooter>
      </SheetAlertDialog>
    </>
  );
}
