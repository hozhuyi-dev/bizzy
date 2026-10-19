import { useState } from "react";
import { useForm, useStore } from "@tanstack/react-form";
import { toPackageFields, toPackageValues } from "../../packages.form";
import { usePackageSave } from "../../packages-save.hook";
import type { PackageView } from "../../packages.types";
import { fieldErrors } from "~/core/utils/form.util";
import { toastRefusal } from "~/features/remedies/components/remedy-buttons/remedy-buttons.component";
import { PAYMENT_METHODS } from "~/features/payments/payments.constant";
import { UnsavedChangesPrompt } from "~/components/shared/unsaved-changes-prompt/unsaved-changes-prompt.component";
import { Checkbox } from "~/components/ui/checkbox";
import { ClientsQuery } from "~/features/clients/clients.query";
import { Button } from "~/components/ui/button";
import { DialogFooter } from "~/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
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
 * A package's client, hours, price and day. One bought in a session
 * stays that session's client's and day: change the session for those.
 */
export function PackageForm({ pkg, clientId, onDone, quiet }: PackageFormProps) {
  const clients = ClientsQuery.useList();
  const save = usePackageSave(pkg, onDone, quiet);
  const [error, setError] = useState<string | null>(null);

  const form = useForm({
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

  const hasChanges = useStore(form.store, (state) => !state.isDefaultValue);

  const items = (clients.data ?? [])
    .map((client) => ({ value: client.id, label: client.name }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <FieldGroup>
        <form.Field
          name="clientId"
          validators={{ onChange: ({ value }) => (value ? undefined : "Choose a client") }}
        >
          {(field) => (
            <Field data-invalid={field.state.meta.errors.length > 0}>
              <FieldLabel>Client</FieldLabel>
              <Select items={items} value={field.state.value} onValueChange={(value) => field.handleChange(value ?? "")}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Choose a client" />
                </SelectTrigger>
                <SelectContent>
                  {items.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError errors={fieldErrors(field.state.meta.errors)} />
            </Field>
          )}
        </form.Field>

        <div className="grid grid-cols-2 gap-4">
          <form.Field
            name="hours"
            validators={{
              onChange: ({ value }) =>
                /^\d+$/.test(value.trim()) && Number(value) >= 1 && Number(value) <= 1000
                  ? undefined
                  : "1 to 1000",
            }}
          >
            {(field) => (
              <Field data-invalid={field.state.meta.errors.length > 0}>
                <FieldLabel htmlFor={field.name}>Hours</FieldLabel>
                <Input
                  id={field.name}
                  inputMode="numeric"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
                <FieldError errors={fieldErrors(field.state.meta.errors)} />
              </Field>
            )}
          </form.Field>

          <form.Field
            name="price"
            validators={{
              onChange: ({ value }) => (parseCents(value) !== null ? undefined : "Like 850 or 850.50"),
            }}
          >
            {(field) => (
              <Field data-invalid={field.state.meta.errors.length > 0}>
                <FieldLabel htmlFor={field.name}>Total price</FieldLabel>
                <Input
                  id={field.name}
                  inputMode="decimal"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
                <FieldError errors={fieldErrors(field.state.meta.errors)} />
              </Field>
            )}
          </form.Field>
        </div>

        <form.Subscribe selector={(state) => [state.values.hours, state.values.price] as const}>
          {([hours, price]) => {
            const cents = parseCents(price);
            const n = Number(hours);
            return cents !== null && n >= 1 ? (
              <FieldDescription>
                {formatCents(Math.round(cents / n))} an hour. Sessions use credits by the half hour.
              </FieldDescription>
            ) : null;
          }}
        </form.Subscribe>

        <form.Field name="purchasedOn">
          {(field) => (
            <Field>
              <FieldLabel htmlFor={field.name}>Bought on</FieldLabel>
              <Input
                id={field.name}
                type="date"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                className="max-w-44"
              />
              <FieldDescription>Credits cover sessions from this day on.</FieldDescription>
            </Field>
          )}
        </form.Field>

        <form.Field name="note">
          {(field) => (
            <Field>
              <FieldLabel htmlFor={field.name}>Note</FieldLabel>
              <Input
                id={field.name}
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
              />
            </Field>
          )}
        </form.Field>

        {pkg?.paid && !pkg.paid.issued && (
          <form.Field name="updatePayment">
            {(field) => (
              <Field orientation="horizontal">
                <Checkbox id={field.name} checked={field.state.value} onCheckedChange={(checked) => field.handleChange(checked)} />
                <FieldLabel htmlFor={field.name}>Update the payment with a new price</FieldLabel>
              </Field>
            )}
          </form.Field>
        )}

        {!pkg?.paid && (
          <form.Field name="paid">
            {(paid) => (
              <Field>
                <div className="flex items-center gap-2">
                  <Checkbox id={paid.name} checked={paid.state.value} onCheckedChange={(checked) => paid.handleChange(checked)} />
                  <FieldLabel htmlFor={paid.name}>Paid on the day it was bought</FieldLabel>
                </div>
                {paid.state.value ? (
                  <form.Field name="paidBy" validators={{ onChange: ({ value }) => (value ? undefined : "Choose how") }}>
                    {(method) => (
                      <div role="radiogroup" aria-label="Paid by" className="flex flex-wrap gap-2">
                        {PAYMENT_METHODS.map((option) => (
                          <Button
                            key={option.value}
                            type="button"
                            role="radio"
                            aria-checked={method.state.value === option.value}
                            variant={method.state.value === option.value ? "default" : "outline"}
                            size="sm"
                            title={option.label}
                            onClick={() => method.handleChange(option.value)}
                          >
                            {option.short}
                          </Button>
                        ))}
                      </div>
                    )}
                  </form.Field>
                ) : (
                  <FieldDescription>Otherwise it goes on your to-do list to collect.</FieldDescription>
                )}
              </Field>
            )}
          </form.Field>
        )}

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </FieldGroup>

      <DialogFooter className="mt-6">
        <form.Subscribe
          selector={(state) => [state.canSubmit, state.isSubmitting, state.values.paid && !state.values.paidBy] as const}
        >
          {([canSubmit, isSubmitting, missingMethod]) => (
            <Button type="submit" disabled={!canSubmit || isSubmitting || missingMethod}>
              {isSubmitting ? "Saving…" : "Save"}
            </Button>
          )}
        </form.Subscribe>
      </DialogFooter>
      <UnsavedChangesPrompt when={hasChanges} />
    </form>
  );
}
