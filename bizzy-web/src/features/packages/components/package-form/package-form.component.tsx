import { useEffect, useRef, useState } from "react";
import { useSelector } from "@tanstack/react-form";
import { toPackageFields, toPackageValues } from "../../packages.form";
import { usePackageSave } from "../../package-save.hook";
import { usePackageActions } from "../../package-actions.hook";
import type { PackageView } from "../../packages.types";
import { moneyError, requiredError, wholeNumberError } from "~/core/utils/form.util";
import { LockedHint } from "~/features/remedies/components/locked-hint/locked-hint.component";
import { saidAbove } from "~/features/remedies/remedies.util";
import { toastRefusal } from "~/features/remedies/components/remedy-buttons/remedy-buttons.component";
import { PAYMENT_CHOICES } from "~/features/payments/payments.constant";
import { methodLabel } from "~/features/payments/payments.util";
import { ClientSelectField } from "~/features/clients/components/client-select-field/client-select-field.component";
import { useAppForm } from "~/components/shared/form/form.hook";
import { UnsavedChangesDialog } from "~/components/shared/dialog/unsaved-changes-dialog/unsaved-changes-dialog.component";
import { ErrorMessage } from "~/components/shared/feedback/error-message/error-message.component";
import { DialogActions } from "~/components/shared/dialog/dialog-actions/dialog-actions.component";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "~/components/ui/field";
import { Separator } from "~/components/ui/separator";
import { formatCents, parseCents } from "~/core/utils/money.util";
import { formatDate, todayISO } from "~/core/utils/date.util";

// Not paid yet: first, so a new package starts left to collect.
const PAID_BY = [{ value: "", label: "Not yet" }, ...PAYMENT_CHOICES];

interface PackageFormProps {
  /** Omitted when adding a package. */
  pkg?: PackageView | undefined;
  /** The client a new one is for, to start with. */
  clientId?: string | undefined;
  /** Once saved, with what the toast says. */
  onDone: (done: string) => void;
  /** Cancel, and once an action from ⋯ is done (Keep as its own, Delete). */
  onClose: () => void;
  /** Leaves the toast to onDone. */
  quiet?: boolean | undefined;
  /** Opened to pay for it ("Mark paid", "Another day…"): its payment comes into view. */
  at?: "payment" | undefined;
}

/**
 * A package's client, hours, price and day, and what was paid for it, all
 * saved at once. What its update can't change now (one bought in a
 * session keeps the session's client and day; a payment an issued receipt
 * records) is disabled, saying why.
 */
export function PackageForm({ pkg, clientId, onDone, onClose, quiet, at }: PackageFormProps) {
  const save = usePackageSave(pkg, onDone, quiet);
  const [error, setError] = useState<string | null>(null);
  const locked = pkg?.locked ?? {};
  const paymentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (at === "payment") paymentRef.current?.scrollIntoView({ block: "start" });
  }, [at]);

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
  // Done to it from ⋯: closes without asking about its edits.
  const actions = usePackageActions(pkg, () => {
    form.reset();
    onClose();
  });

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

        <Separator />

        <div ref={paymentRef} className="flex scroll-mt-4 flex-col gap-4">
          {locked.payment && pkg?.paid ? (
            <Field>
              <FieldLabel>Paid</FieldLabel>
              <p className="text-sm">
                <b>{formatCents(pkg.paid.amountCents)}</b> by {methodLabel(pkg.paid.method)} on {formatDate(pkg.paid.paidOn)}
              </p>
              <LockedHint lock={locked.payment} />
            </Field>
          ) : (
            <>
              <form.Subscribe selector={(state) => [state.values.paidBy, state.values.price] as const}>
                {([paidBy, price]) => (
                  <form.AppField name="paidBy">
                    {(field) => (
                      <field.ChoiceField
                        label="Paid"
                        options={PAID_BY}
                        description={paidHelp(pkg, paidBy, parseCents(price))}
                      />
                    )}
                  </form.AppField>
                )}
              </form.Subscribe>
              <form.Subscribe selector={(state) => state.values.paidBy}>
                {(paidBy) =>
                  paidBy && (
                    <form.AppField
                      name="paidOn"
                      validators={{ onChange: ({ value }) => requiredError(value, "Choose the day it was paid") }}
                    >
                      {(field) => (
                        <field.TextField
                          label="Paid on"
                          type="date"
                          inputClassName="max-w-44"
                          // Money comes in on a day that has come; one ahead is most likely a slip.
                          description={field.state.value > todayISO() ? "That day hasn't come yet." : undefined}
                        />
                      )}
                    </form.AppField>
                  )
                }
              </form.Subscribe>
            </>
          )}
        </div>

        {error && <ErrorMessage>{error}</ErrorMessage>}
      </FieldGroup>

      <DialogActions menu={actions.menu} confirm={actions.confirm} onCancel={onClose} className="mt-6">
        <form.AppForm>
          <form.SubmitButton label={pkg ? "Save" : "Add package"} />
        </form.AppForm>
      </DialogActions>
      <UnsavedChangesDialog when={hasChanges} />
    </form>
  );
}

/** What saving does to the payment, as the section stands: collect it, undo it, or move it to a new price. */
function paidHelp(pkg: PackageView | undefined, paidBy: string, priceCents: number | null): string | undefined {
  const paid = pkg?.paid;
  if (!paidBy) return paid ? "Saving undoes the payment recorded." : "It goes on your to-do list to collect.";
  if (paid && priceCents !== null && priceCents !== pkg.priceCents) return "Paid in full: the payment moves to the new price.";
  return undefined;
}
