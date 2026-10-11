import { useForm } from "@tanstack/react-form";
import { toast } from "sonner";
import { extraAliases } from "../../clients.columns";
import { ClientsMutation } from "../../clients.mutation";
import type { Client, SaveClientInput } from "../../clients.types";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { DialogFooter } from "~/components/ui/dialog";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { centsToInput, parseCents } from "~/core/utils/money.util";

interface ClientFormProps {
  /** Omitted when creating a client. */
  client?: Client | undefined;
  /** Prefills a new client, e.g. from an unmatched calendar name. */
  initialName?: string | undefined;
  onDone: (client: Client) => void;
}

interface ClientFormValues {
  name: string;
  email: string;
  phone: string;
  address: string;
  postcode: string;
  /** Comma-separated; easier to type on a phone than a tag input. */
  aliases: string;
  defaultFee: string;
  homeVisits: boolean;
}

function toFormValues(client: Client | undefined, initialName: string | undefined): ClientFormValues {
  return {
    name: client?.name ?? initialName ?? "",
    email: client?.email ?? "",
    phone: client?.phone ?? "",
    address: client?.address ?? "",
    postcode: client?.postcode ?? "",
    aliases: client ? extraAliases(client).join(", ") : "",
    defaultFee: centsToInput(client?.defaultFeeCents),
    homeVisits: client?.homeVisits ?? false,
  };
}

/** Adapts TanStack Form's string errors to the shape FieldError renders. */
function fieldErrors(errors: ReadonlyArray<string | undefined>) {
  return errors.flatMap((message) => (message ? [{ message }] : []));
}

function optional<TKey extends string>(key: TKey, value: string): Partial<Record<TKey, string>> {
  const trimmed = value.trim();
  return trimmed ? ({ [key]: trimmed } as Record<TKey, string>) : {};
}

function toInput(values: ClientFormValues, id: string | undefined): SaveClientInput {
  const fee = values.defaultFee.trim();
  return {
    ...(id ? { id } : {}),
    name: values.name,
    ...optional("email", values.email),
    ...optional("phone", values.phone),
    ...optional("address", values.address),
    ...optional("postcode", values.postcode),
    aliases: values.aliases.split(",").map((alias) => alias.trim()).filter(Boolean),
    ...(fee ? { defaultFeeCents: parseCents(fee) ?? 0 } : {}),
    ...(values.homeVisits ? { homeVisits: true } : {}),
  };
}

export function ClientForm({ client, initialName, onDone }: ClientFormProps) {
  const save = ClientsMutation.useSave();

  const form = useForm({
    defaultValues: toFormValues(client, initialName),
    onSubmit: async ({ value }) => {
      const saved = await save.mutateAsync(toInput(value, client?.id));
      toast.success(client ? "Client updated" : "Client added");
      onDone(saved);
    },
  });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <FieldGroup>
        <form.Field
          name="name"
          validators={{
            onChange: ({ value }) =>
              value.trim() ? undefined : "Name is required",
          }}
        >
          {(field) => (
            <Field data-invalid={field.state.meta.errors.length > 0}>
              <FieldLabel htmlFor={field.name}>Name</FieldLabel>
              <Input
                id={field.name}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
                autoComplete="off"
              />
              <FieldError errors={fieldErrors(field.state.meta.errors)} />
            </Field>
          )}
        </form.Field>

        <form.Field name="aliases">
          {(field) => (
            <Field>
              <FieldLabel htmlFor={field.name}>Other calendar names</FieldLabel>
              <Input
                id={field.name}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
                placeholder="Jane S, Janey"
                autoComplete="off"
              />
              <FieldDescription>
                Comma-separated. The name above always matches.
              </FieldDescription>
            </Field>
          )}
        </form.Field>

        <form.Field
          name="defaultFee"
          validators={{
            onChange: ({ value }) =>
              !value.trim() || parseCents(value) !== null
                ? undefined
                : "Enter an amount like 95 or 95.50",
          }}
        >
          {(field) => (
            <Field data-invalid={field.state.meta.errors.length > 0}>
              <FieldLabel htmlFor={field.name}>Default fee</FieldLabel>
              <Input
                id={field.name}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
                inputMode="decimal"
                placeholder="95"
              />
              <FieldDescription>
                Used when a calendar entry has no amount and no package credit.
              </FieldDescription>
              <FieldError errors={fieldErrors(field.state.meta.errors)} />
            </Field>
          )}
        </form.Field>

        <form.Field name="homeVisits">
          {(field) => (
            <Field orientation="horizontal">
              <Checkbox
                id={field.name}
                checked={field.state.value}
                onCheckedChange={(checked) => field.handleChange(checked)}
              />
              <FieldContent>
                <FieldLabel htmlFor={field.name}>Usually a home visit</FieldLabel>
                <FieldDescription>
                  An event colour set in the calendar still wins.
                </FieldDescription>
              </FieldContent>
            </Field>
          )}
        </form.Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <form.Field name="phone">
            {(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>Phone</FieldLabel>
                <Input
                  id={field.name}
                  type="tel"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  placeholder="012-345 6789"
                />
              </Field>
            )}
          </form.Field>

          <form.Field name="email">
            {(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>Email</FieldLabel>
                <Input
                  id={field.name}
                  type="email"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
              </Field>
            )}
          </form.Field>
        </div>

        <form.Field name="address">
          {(field) => (
            <Field>
              <FieldLabel htmlFor={field.name}>Address</FieldLabel>
              <Textarea
                id={field.name}
                rows={2}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
              />
              <FieldDescription>Printed on receipts.</FieldDescription>
            </Field>
          )}
        </form.Field>

        <form.Field name="postcode">
          {(field) => (
            <Field>
              <FieldLabel htmlFor={field.name}>Postcode</FieldLabel>
              <Input
                id={field.name}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
                inputMode="numeric"
                className="max-w-32"
              />
              <FieldDescription>Kept apart so clients can be grouped by area.</FieldDescription>
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
