import { useState } from "react";
import { useSelector } from "@tanstack/react-form";
import { toPackageFields, toPackageValues } from "../../packages.form";
import { usePackageSave } from "../../package-save.hook";
import type { PackageView } from "../../packages.types";
import { moneyError, requiredError, wholeNumberError } from "~/core/utils/form.util";
import { LockedHint } from "~/features/remedies/components/locked-hint/locked-hint.component";
import { saidAbove } from "~/features/remedies/remedies.util";
import { toastRefusal } from "~/features/remedies/components/remedy-buttons/remedy-buttons.component";
import { PAYMENT_CHOICES } from "~/features/payments/payments.constant";
import { ClientSelectField } from "~/features/clients/components/client-select-field/client-select-field.component";
import { useAppForm } from "~/components/shared/form/form.hook";
import { UnsavedChangesDialog } from "~/components/shared/dialog/unsaved-changes-dialog/unsaved-changes-dialog.component";
import { ErrorMessage } from "~/components/shared/feedback/error-message/error-message.component";
import { DialogFooter } from "~/components/ui/dialog";
import { FieldDescription, FieldGroup } from "~/components/ui/field";
import { formatCents, parseCents } from "~/core/utils/money.util";

interface PackageFormProps {
  /** Omitted when adding a package. */
  pkg?: PackageView | undefined;
  /** The client a new one is for, to start with. */
  clientId?: string | undefined;
  /** Once saved, with what the toast says. */
  onDone: (done: string) => void;
  /** Leaves the toast to onDone. */
  quiet?: boolean;
}

/**
 * A package's client, hours, price and day. What its update can't change
 * now (one bought in a session keeps the session's client and day) is
 * disabled, saying why.
 */
export function PackageForm({ pkg, clientId, onDone, quiet }: PackageFormProps) {
  const save = usePackageSave(pkg, onDone, quiet);
  const [error, setError] = useState<string | null>(null);
  const locked = pkg?.locked ?? {};

  const form = useAppForm({
    defaultValues: toPackageValues(pkg, clientId),
    onSubmit: async ({ value }) => {
      setError(null);
      try {
        await save.submit(toPackageFields(value, pkg));
      } catch (e) {
        // Shown with what would let it through, and kept on the form.
        toastRefusal(e);
        setError((e as Error).message);
      }
    },
  });

  const hasChanges = useSelector(form.store, (state) => !state.isDefaultValue);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <FieldGroup>
        <form.AppField name="clientId" validators={{ onChange: ({ value }) => requiredError(value, "Choose a client") }}>
          {() => (
            <ClientSelectField
              keepId={pkg?.clientId ?? clientId}
              disabled={locked.clientId !== undefined}
              hint={<LockedHint lock={locked.clientId} />}
            />
          )}
        </form.AppField>

        <div className="grid grid-cols-2 gap-4">
          <form.AppField name="hours" validators={{ onChange: ({ value }) => wholeNumberError(value, 1, 1000) }}>
            {(field) => (
              <field.TextField
                label="Hours"
                inputMode="numeric"
                disabled={locked.hours !== undefined}
                hint={<LockedHint lock={locked.hours} again={saidAbove(locked.hours, locked.clientId)} />}
              />
            )}
          </form.AppField>

          <form.AppField
            name="price"
            validators={{ onChange: ({ value }) => moneyError(value, { required: "What does it cost?", positive: true }) }}
          >
            {(field) => (
              <field.TextField
                label="Total price"
                inputMode="decimal"
                disabled={locked.priceCents !== undefined}
                hint={<LockedHint lock={locked.priceCents} again={saidAbove(locked.priceCents, locked.clientId, locked.hours)} />}
              />
            )}
          </form.AppField>
        </div>

        <form.Subscribe selector={(state) => [state.values.hours, state.values.price] as const}>
          {([hours, price]) => {
            const cents = parseCents(price);
            const n = Number(hours);
            return cents !== null && Number.isInteger(n) && n >= 1 ? (
              <FieldDescription>
                {formatCents(Math.round(cents / n))} an hour. Sessions use credits by the half hour.
              </FieldDescription>
            ) : null;
          }}
        </form.Subscribe>

        <form.AppField name="purchasedOn" validators={{ onChange: ({ value }) => requiredError(value, "Choose the day it was bought") }}>
          {(field) => (
            <field.TextField
              label="Bought on"
              type="date"
              inputClassName="max-w-44"
              disabled={locked.purchasedAt !== undefined}
              description="Credits cover sessions from this day on."
              hint={
                <LockedHint
                  lock={locked.purchasedAt}
                  again={saidAbove(locked.purchasedAt, locked.clientId, locked.hours, locked.priceCents)}
                />
              }
            />
          )}
        </form.AppField>

        <form.AppField name="note">{(field) => <field.TextField label="Note" />}</form.AppField>

        {pkg?.paid && !pkg.paid.issued && (
          <form.AppField name="updatePayment">
            {(field) => <field.CheckboxField label="Update the payment with a new price" />}
          </form.AppField>
        )}

        {!pkg?.paid && (
          <>
            <form.AppField name="paid">
              {(field) => (
                <field.CheckboxField
                  label="Paid on the day it was bought"
                  description={field.state.value ? undefined : "Otherwise it goes on your to-do list to collect."}
                />
              )}
            </form.AppField>
            <form.Subscribe selector={(state) => state.values.paid}>
              {(paid) =>
                paid && (
                  <form.AppField
                    name="paidBy"
                    validators={{
                      onChangeListenTo: ["paid"],
                      onChange: ({ value, fieldApi }) =>
                        fieldApi.form.getFieldValue("paid") && !value ? "Choose how it was paid" : undefined,
                    }}
                  >
                    {(field) => <field.ChoiceField label="Paid by" labelClassName="sr-only" options={PAYMENT_CHOICES} />}
                  </form.AppField>
                )
              }
            </form.Subscribe>
          </>
        )}

        {error && <ErrorMessage>{error}</ErrorMessage>}
      </FieldGroup>

      <DialogFooter className="mt-6">
        <form.AppForm>
          <form.SubmitButton label="Save" />
        </form.AppForm>
      </DialogFooter>
      <UnsavedChangesDialog when={hasChanges} />
    </form>
  );
}
