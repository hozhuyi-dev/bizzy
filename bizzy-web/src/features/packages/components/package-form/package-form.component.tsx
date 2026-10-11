import { useForm } from "@tanstack/react-form";
import { toast } from "sonner";
import { PackagesMutation } from "../../packages.query";
import type { Package } from "../../packages.types";
import { ClientsQuery } from "~/features/clients/clients.query";
import { Button } from "~/components/ui/button";
import { DialogFooter } from "~/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { centsToInput, formatCents, parseCents } from "~/core/utils/money.util";
import { toISODate, todayISO } from "~/core/utils/date.util";

interface PackageFormProps {
  /** Omitted when adding a package. */
  pkg?: Package | undefined;
  onDone: () => void;
}

interface PackageFormValues {
  clientId: string;
  sessions: string;
  /** Total price, as she'd write after the @. */
  price: string;
  purchasedOn: string;
  note: string;
}

function fieldErrors(errors: ReadonlyArray<string | undefined>) {
  return errors.flatMap((message) => (message ? [{ message }] : []));
}

/**
 * For packages bought outside the calendar. Ones bought with `10x85` or
 * `10@850` in a session title are edited in the calendar.
 */
export function PackageForm({ pkg, onDone }: PackageFormProps) {
  const clients = ClientsQuery.useList();
  const save = PackagesMutation.useSave();

  const form = useForm({
    defaultValues: {
      clientId: pkg?.clientId ?? "",
      sessions: pkg ? String(pkg.sessions) : "10",
      price: centsToInput(pkg?.priceCents),
      purchasedOn: pkg ? toISODate(new Date(pkg.purchasedAt)) : todayISO(),
      note: pkg?.note ?? "",
    } satisfies PackageFormValues,
    onSubmit: async ({ value }) => {
      const [year = 0, month = 1, day = 1] = value.purchasedOn.split("-").map(Number);
      await save.mutateAsync({
        ...(pkg ? { id: pkg.id } : {}),
        clientId: value.clientId,
        sessions: Number(value.sessions),
        priceCents: parseCents(value.price) ?? 0,
        // Start of her day, so it covers that day's sessions.
        purchasedAt: new Date(year, month - 1, day).toISOString(),
        note: value.note,
      });
      toast.success(pkg ? "Package updated" : "Package added");
      onDone();
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

        {save.error && (
          <p role="alert" className="text-sm text-destructive">
            {save.error.message}
          </p>
        )}
      </FieldGroup>

      <DialogFooter className="mt-6">
        <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>
          {([canSubmit, isSubmitting]) => (
            <Button type="submit" disabled={!canSubmit || isSubmitting}>
              {isSubmitting ? "Saving…" : "Save"}
            </Button>
          )}
        </form.Subscribe>
      </DialogFooter>
    </form>
  );
}
