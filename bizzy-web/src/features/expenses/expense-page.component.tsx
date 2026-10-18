import { useState } from "react";
import { useForm, useStore } from "@tanstack/react-form";
import { useNavigate } from "@tanstack/react-router";
import { CircleAlertIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { EMPTY_LINE, amountError, toExpenseFields, toExpenseValues, totalOf, withName } from "./expenses.form";
import { ExpensesMutation } from "./expenses.mutation";
import { ExpensesQuery } from "./expenses.query";
import { vendorsOf } from "./expenses.util";
import type { CatalogueView, ExpenseView } from "./expenses.types";
import type { PageSection } from "~/components/shared/section-layout/section-layout.component";
import { AttachmentList } from "~/features/attachments/components/attachment-list/attachment-list.component";
import { Banner } from "~/components/shared/banner/banner.component";
import { PageHeader } from "~/components/shared/page-header/page-header.component";
import { Loading } from "~/components/shared/quip/quip.component";
import { SectionLayout } from "~/components/shared/section-layout/section-layout.component";
import { UnsavedChangesPrompt } from "~/components/shared/unsaved-changes-prompt/unsaved-changes-prompt.component";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Textarea } from "~/components/ui/textarea";
import { formatCents } from "~/core/utils/money.util";
import { fieldErrors } from "~/core/utils/form.util";

const FORM_ID = "expense-form";

const parent = { to: "/expenses", label: "Expenses" } as const;

export type ExpensePageProps = { mode: "new" } | { mode: "edit"; id: string };

/** One receipt: where and when, what was on it, and the receipt itself. */
export function ExpensePage(props: ExpensePageProps) {
  const catalogue = ExpensesQuery.useCatalogue();
  const expense = ExpensesQuery.useDetail(props.mode === "edit" ? props.id : undefined);

  const pending = catalogue.isPending || (props.mode === "edit" && expense.isPending);
  const error = catalogue.error ?? (props.mode === "edit" ? expense.error : null);
  if (pending || error || !catalogue.data) {
    return (
      <>
        <PageHeader parent={parent} title={error ? "Not available" : "…"} />
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error.message}
          </p>
        ) : (
          <Loading />
        )}
      </>
    );
  }
  const current = props.mode === "edit" ? expense.data : undefined;
  return <ExpenseEditor key={current?.id ?? "new"} expense={current ?? undefined} catalogue={catalogue.data} />;
}

interface ExpenseEditorProps {
  expense: ExpenseView | undefined;
  catalogue: CatalogueView;
}

function ExpenseEditor({ expense, catalogue }: ExpenseEditorProps) {
  const create = ExpensesMutation.useCreate();
  const update = ExpensesMutation.useUpdate();
  const remove = ExpensesMutation.useDelete();
  const save = expense ? update : create;
  const navigate = useNavigate();
  const [deleting, setDeleting] = useState(false);
  // The form starts from the expense once: attaching a file refetches it,
  // which must not undo what the user is typing. A save moves it on.
  const [defaultValues, setDefaultValues] = useState(() => toExpenseValues(expense));
  const thisYear = ExpensesQuery.useYear(new Date().getFullYear());
  const vendors = vendorsOf(thisYear.data ?? []);
  const items = catalogue.items.filter((item) => !item.archived);
  const categories = catalogue.categories.filter((category) => !category.archived);

  const form = useForm({
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

  const isSubmitting = useStore(form.store, (state) => state.isSubmitting);
  const hasChanges = useStore(form.store, (state) => !state.isDefaultValue);

  const sections: Array<PageSection> = [
    {
      id: "receipt",
      title: "Receipt",
      content: (
        <FieldGroup>
          <form.Field
            name="date"
            validators={{ onSubmit: ({ value }) => (value ? undefined : "Choose the day on the receipt") }}
          >
            {(field) => (
              <Field data-invalid={field.state.meta.errors.length > 0}>
                <FieldLabel htmlFor={field.name}>Date</FieldLabel>
                <Input
                  id={field.name}
                  type="date"
                  form={FORM_ID}
                  className="max-w-44"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
                <FieldError errors={fieldErrors(field.state.meta.errors)} />
              </Field>
            )}
          </form.Field>
          <form.Field name="vendor">
            {(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>Where</FieldLabel>
                <Input
                  id={field.name}
                  form={FORM_ID}
                  list="expense-vendors"
                  maxLength={100}
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  placeholder="Shopee, the pharmacy, Petronas"
                  autoComplete="off"
                />
                <datalist id="expense-vendors">
                  {vendors.map((vendor) => (
                    <option key={vendor} value={vendor} />
                  ))}
                </datalist>
                <FieldDescription>The shop or website it was bought from.</FieldDescription>
              </Field>
            )}
          </form.Field>
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
              <datalist id="expense-items">
                {items.map((item) => (
                  <option key={item.id} value={item.name} />
                ))}
              </datalist>
              {linesField.state.value.map((line, i) => (
                <div
                  key={i}
                  className="grid items-start gap-2 border-b pb-3 md:grid-cols-[minmax(0,1fr)_minmax(0,14rem)_7rem_auto]"
                >
                  <form.Field
                    name={`lines[${i}].name`}
                    validators={{ onSubmit: ({ value }) => (value.trim() ? undefined : "What was bought?") }}
                  >
                    {(field) => (
                      <Field data-invalid={field.state.meta.errors.length > 0}>
                        <FieldLabel htmlFor={field.name} className="md:sr-only">
                          Item
                        </FieldLabel>
                        <Input
                          id={field.name}
                          form={FORM_ID}
                          list="expense-items"
                          maxLength={100}
                          value={field.state.value}
                          placeholder="Kinesio tape"
                          autoComplete="off"
                          onChange={(e) => linesField.replaceValue(i, withName(line, e.target.value, catalogue))}
                        />
                        <FieldError errors={fieldErrors(field.state.meta.errors)} />
                      </Field>
                    )}
                  </form.Field>
                  <form.Field
                    name={`lines[${i}].categoryId`}
                    validators={{ onSubmit: ({ value }) => (value ? undefined : "Choose a category") }}
                  >
                    {(field) => (
                      <Field data-invalid={field.state.meta.errors.length > 0}>
                        <FieldLabel className="md:sr-only">Category</FieldLabel>
                        <Select
                          items={catalogue.categories.map((category) => ({ value: category.id, label: category.name }))}
                          value={field.state.value}
                          onValueChange={(value) => field.handleChange(value ?? "")}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Category" />
                          </SelectTrigger>
                          <SelectContent>
                            {categories.map((category) => (
                              <SelectItem key={category.id} value={category.id}>
                                {category.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FieldError errors={fieldErrors(field.state.meta.errors)} />
                      </Field>
                    )}
                  </form.Field>
                  <form.Field
                    name={`lines[${i}].amount`}
                    validators={{
                      onChange: ({ value }) => (value ? amountError(value) : undefined),
                      onSubmit: ({ value }) => amountError(value),
                    }}
                  >
                    {(field) => (
                      <Field data-invalid={field.state.meta.errors.length > 0}>
                        <FieldLabel htmlFor={field.name} className="md:sr-only">
                          Amount
                        </FieldLabel>
                        <Input
                          id={field.name}
                          form={FORM_ID}
                          inputMode="decimal"
                          className="text-right"
                          value={field.state.value}
                          placeholder="0.00"
                          onChange={(e) => field.handleChange(e.target.value)}
                        />
                        <FieldError errors={fieldErrors(field.state.meta.errors)} />
                      </Field>
                    )}
                  </form.Field>
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
                <Button type="button" variant="outline" size="sm" onClick={() => linesField.pushValue({ ...EMPTY_LINE })}>
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
        <form.Field name="notes">
          {(field) => (
            <Field>
              <FieldLabel htmlFor={field.name} className="sr-only">
                Notes
              </FieldLabel>
              <Textarea
                id={field.name}
                value={field.state.value}
                maxLength={2000}
                placeholder="What it was for, a warranty, who to claim it from…"
                onChange={(e) => field.handleChange(e.target.value)}
              />
            </Field>
          )}
        </form.Field>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        parent={parent}
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
        moreActions={
          expense
            ? [{ type: "button", label: "Delete", icon: Trash2Icon, style: "destructive", onClick: () => setDeleting(true) }]
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
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      />
      <SectionLayout sections={sections} />
      <UnsavedChangesPrompt when={hasChanges} />

      <AlertDialog open={deleting} onOpenChange={setDeleting}>
        <AlertDialogContent>
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
                    void navigate({ to: "/expenses", ignoreBlocker: true });
                  },
                  onError: (error) => toast.error(error.message),
                  onSettled: () => setDeleting(false),
                })
              }
            >
              {remove.isPending ? "Deleting…" : "Delete"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
