import { useSelector } from "@tanstack/react-form";
import { ArchiveIcon, ArchiveRestoreIcon } from "lucide-react";
import { toast } from "sonner";
import { ExpensesMutation } from "./expenses.mutation";
import { ExpensesQuery } from "./expenses.query";
import type { LinkOptions } from "@tanstack/react-router";
import type { CatalogueView, ExpenseItem } from "./expenses.types";
import type { Action } from "~/components/shared/actions/action-bar/action-bar.types";
import { PageHeader } from "~/components/shared/layout/page-header/page-header.component";
import { PageSections } from "~/components/shared/layout/page-sections/page-sections.component";
import { UnsavedChangesDialog } from "~/components/shared/dialog/unsaved-changes-dialog/unsaved-changes-dialog.component";
import { ErrorState } from "~/components/shared/feedback/error-state/error-state.component";
import { LoadingState } from "~/components/shared/feedback/loading-state/loading-state.component";
import { NotFoundPage } from "~/components/shared/feedback/not-found-page/not-found-page.component";
import { Badge } from "~/components/ui/badge";
import { FieldGroup } from "~/components/ui/field";
import { useAppForm } from "~/components/shared/form/form.hook";
import { requiredError } from "~/core/utils/form.util";
import { toastRefusal } from "~/features/remedies/components/remedy-buttons/remedy-buttons.component";

const FORM_ID = "expense-item-form";

/** As the API keeps an item's name. */
const MAX_NAME = 100;

/** Opened from wherever it was needed, it goes back there; else to the items. */
const PARENT = { to: "/expenses/items", label: "Items" } as const;

/** One thing the user buys: renamed, moved to another category for lines from now on, or archived. */
export function ExpenseItemPage({ id }: { id: string }) {
  const catalogue = ExpensesQuery.useCatalogue();
  const item = catalogue.data?.items.find((i) => i.id === id);

  if (catalogue.data && item) return <ItemEditor item={item} catalogue={catalogue.data} />;
  if (catalogue.data) {
    return (
      <>
        <PageHeader parent={PARENT} title="Not available" />
        <NotFoundPage message="This item isn't there any more." back={{ label: `Back to ${PARENT.label}`, link: PARENT as LinkOptions }} />
      </>
    );
  }
  return (
    <>
      <PageHeader parent={PARENT} title={catalogue.error ? "Not available" : "…"} />
      {catalogue.error ? (
        <ErrorState
          error={catalogue.error}
          retry={catalogue.refetch}
          size="page"
          back={{ label: `Back to ${PARENT.label}`, link: PARENT as LinkOptions }}
        />
      ) : (
        <LoadingState shape="page" />
      )}
    </>
  );
}

function ItemEditor({ item, catalogue }: { item: ExpenseItem; catalogue: CatalogueView }) {
  const save = ExpensesMutation.useSaveItem();
  const all = catalogue.categories.map((c) => ({ value: c.id, label: c.name }));
  const offered = catalogue.categories
    .filter((c) => !c.archived || c.id === item.categoryId)
    .map((c) => ({ value: c.id, label: c.name }));

  const form = useAppForm({
    defaultValues: { ...item, archived: item.archived ?? false },
    onSubmit: async ({ value, formApi }) => {
      try {
        await save.mutateAsync(value);
        formApi.reset(value);
        toast.success("Item saved");
      } catch (error) {
        toastRefusal(error);
      }
    },
  });
  const isSubmitting = useSelector(form.store, (state) => state.isSubmitting);
  const hasChanges = useSelector(form.store, (state) => !state.isDefaultValue);

  const submit: Action = { type: "submit", form: FORM_ID, label: "Save", style: "primary", pending: isSubmitting };
  // Archived, it isn't suggested on new expenses; those recorded keep it.
  // As a client's, an action, not a field: done at once.
  const archive: Action = {
    type: "button",
    label: item.archived ? "Unarchive" : "Archive",
    icon: item.archived ? ArchiveRestoreIcon : ArchiveIcon,
    pending: save.isPending && !isSubmitting,
    disabled: isSubmitting,
    onClick: () =>
      save.mutate(
        { ...item, archived: !item.archived },
        {
          onSuccess: () => toast.success(item.archived ? `${item.name} is suggested again` : `${item.name} archived`),
          onError: toastRefusal,
        },
      ),
  };

  return (
    <>
      <PageHeader
        parent={PARENT}
        title={item.name}
        kind="Item"
        badges={item.archived && <Badge variant="neutral">Archived</Badge>}
        actions={hasChanges ? [submit] : []}
        menuActions={[archive]}
      />
      <form
        id={FORM_ID}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <PageSections
          sections={[
            {
              id: "item",
              title: "Item",
              description: "Expenses already recorded keep the name and category they were saved with.",
              content: (
                <FieldGroup>
                  <form.AppField name="name" validators={{ onChange: ({ value }) => requiredError(value, "Name the item") }}>
                    {(field) => <field.TextField label="Name" maxLength={MAX_NAME} />}
                  </form.AppField>
                  <form.AppField name="categoryId" validators={{ onChange: ({ value }) => requiredError(value, "Choose a category") }}>
                    {(field) => <field.SelectField label="Category" items={all} options={offered} />}
                  </form.AppField>
                </FieldGroup>
              ),
            },
          ]}
        />
      </form>
      <UnsavedChangesDialog when={hasChanges} />
    </>
  );
}
