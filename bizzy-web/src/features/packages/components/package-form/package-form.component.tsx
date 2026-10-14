import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { toPackageInput, toPackageValues } from "../../packages.form";
import { usePackageSave } from "../../packages-impact.hook";
import type { Package } from "../../packages.types";
import { fieldErrors } from "~/core/utils/form.util";
import { PAYMENT_METHODS } from "~/features/payments/payments.constant";
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
  pkg?: Package | undefined;
  onDone: () => void;
}

/**
 * For packages bought outside the calendar. Ones bought with `10x85` or
 * `10@850` in a session title are edited in the calendar.
 */
export function PackageForm({ pkg, onDone }: PackageFormProps) {
  const clients = ClientsQuery.useList();
  const save = usePackageSave(pkg, onDone);
  const [error, setError] = useState<string | null>(null);

  const form = useForm({
    defaultValues: toPackageValues(pkg),
    onSubmit: async ({ value }) => {
      setError(null);
      try {
        await save.submit(toPackageInput(value, pkg?.id));
      } catch (e) {
        setError((e as Error).message);
      }
    },
  });

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
            name="sessions"
            validators={{
              onChange: ({ value }) =>
                /^\d+$/.test(value.trim()) && Number(value) >= 1 && Number(value) <= 1000
                  ? undefined
                  : "1 to 1000",
            }}
          >
            {(field) => (
              <Field data-invalid={field.state.meta.errors.length > 0}>
                <FieldLabel htmlFor={field.name}>Sessions</FieldLabel>
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

        <form.Subscribe selector={(state) => [state.values.sessions, state.values.price] as const}>
          {([sessions, price]) => {
            const cents = parseCents(price);
            const n = Number(sessions);
            return cents !== null && n >= 1 ? (
              <FieldDescription>{formatCents(Math.round(cents / n))} per session</FieldDescription>
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

        {!pkg?.payment && (
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
      {save.dialog}
    </form>
  );
}
