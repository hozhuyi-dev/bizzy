import { useSelector } from "@tanstack/react-form";
import { ArchiveIcon, ArchiveRestoreIcon, ReceiptTextIcon } from "lucide-react";
import { toast } from "sonner";
import { ExpensesMutation } from "./expenses.mutation";
import { ExpensesQuery } from "./expenses.query";
import { receiptsOf } from "./expenses.util";
import type { LinkOptions } from "@tanstack/react-router";
import type { Vendor } from "./expenses.types";
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
import { formatDate } from "~/core/utils/date.util";
import { toastRefusal } from "~/features/remedies/components/remedy-buttons/remedy-buttons.component";

const FORM_ID = "expense-vendor-form";

/** As the API keeps a shop's name. */
const MAX_NAME = 100;

/** Opened from wherever it was needed, it goes back there; else to the shops. */
const PARENT = { to: "/expenses/vendors", label: "Shops" } as const;

/**
 * Somewhere the user buys from, as the list suggests it: renamed (a typo)
 * or archived, out of the suggestions. Receipts keep what was typed on
 * them; See receipts lists those of this name.
 */
export function ExpenseVendorPage({ id }: { id: string }) {
  const catalogue = ExpensesQuery.useCatalogue();
  const vendor = catalogue.data?.vendors.find((v) => v.id === id);

  if (vendor) return <VendorEditor vendor={vendor} />;
  if (catalogue.data) {
    return (
      <>
        <PageHeader parent={PARENT} title="Not available" />
        <NotFoundPage message="This shop isn't there any more." back={{ label: `Back to ${PARENT.label}`, link: PARENT as LinkOptions }} />
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

function VendorEditor({ vendor }: { vendor: Vendor }) {
  const save = ExpensesMutation.useSaveVendor();

  const form = useAppForm({
    defaultValues: { ...vendor, archived: vendor.archived ?? false },
    onSubmit: async ({ value, formApi }) => {
      try {
        await save.mutateAsync(value);
        formApi.reset(value);
        toast.success("Shop saved");
      } catch (error) {
        toastRefusal(error);
      }
    },
  });
  const isSubmitting = useSelector(form.store, (state) => state.isSubmitting);
  const hasChanges = useSelector(form.store, (state) => !state.isDefaultValue);

  const submit: Action = { type: "submit", form: FORM_ID, label: "Save", style: "primary", pending: isSubmitting };
  const receipts: Action = { type: "link", label: "See receipts", icon: ReceiptTextIcon, link: receiptsOf("vendor", vendor.name) };
  // Archived, it isn't suggested on new expenses; those recorded keep it.
  // As an item's, an action, not a field: done at once.
  const archive: Action = {
    type: "button",
    label: vendor.archived ? "Unarchive" : "Archive",
    icon: vendor.archived ? ArchiveRestoreIcon : ArchiveIcon,
    pending: save.isPending && !isSubmitting,
    disabled: isSubmitting,
    onClick: () =>
      save.mutate(
        { ...vendor, archived: !vendor.archived },
        {
          onSuccess: () => toast.success(vendor.archived ? `${vendor.name} is suggested again` : `${vendor.name} archived`),
          onError: toastRefusal,
        },
      ),
  };

  return (
    <>
      <PageHeader
        parent={PARENT}
        title={vendor.name}
        kind="Shop"
        subtitle={`Last receipt ${formatDate(vendor.lastUsed)}`}
        badges={vendor.archived && <Badge variant="neutral">Archived</Badge>}
        actions={hasChanges ? [submit] : []}
        moreActions={[receipts]}
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
              id: "shop",
              title: "Shop",
              description: "What is suggested as a receipt's shop is typed. Expenses already recorded keep the name they were saved with.",
              content: (
                <FieldGroup>
                  <form.AppField name="name" validators={{ onChange: ({ value }) => requiredError(value, "Name the shop") }}>
                    {(field) => <field.TextField label="Name" maxLength={MAX_NAME} />}
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
