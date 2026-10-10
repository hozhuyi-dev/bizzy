import { useForm } from "@tanstack/react-form";
import { toast } from "sonner";
import { extraAliases } from "../../clients.columns";
import { ClientsMutation } from "../../clients.mutation";
import type { Client, SaveClientInput } from "../../clients.types";
import { Button } from "~/components/ui/button";
import { DialogFooter } from "~/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { centsToInput, parseCents } from "~/core/utils/money.util";

interface ClientFormProps {
  /** Omitted when creating a client. */
  client?: Client;
  onDone: () => void;
}

interface ClientFormValues {
  name: string;
  email: string;
  /** Comma-separated; easier to type on a phone than a tag input. */
  aliases: string;
  defaultFee: string;
}

function toFormValues(client: Client | undefined): ClientFormValues {
  return {
    name: client?.name ?? "",
    email: client?.email ?? "",
    aliases: client ? extraAliases(client).join(", ") : "",
    defaultFee: centsToInput(client?.defaultFeeCents),
  };
}

/** Adapts TanStack Form's string errors to the shape FieldError renders. */
function fieldErrors(errors: ReadonlyArray<string | undefined>) {
  return errors.flatMap((message) => (message ? [{ message }] : []));
}

function toInput(values: ClientFormValues, id: string | undefined): SaveClientInput {
  const fee = values.defaultFee.trim();
  return {
    ...(id ? { id } : {}),
    name: values.name,
    ...(values.email.trim() ? { email: values.email.trim() } : {}),
    aliases: values.aliases.split(",").map((alias) => alias.trim()).filter(Boolean),
    ...(fee ? { defaultFeeCents: parseCents(fee) ?? 0 } : {}),
  };
}

export function ClientForm({ client, onDone }: ClientFormProps) {
  const save = ClientsMutation.useSave();

  const form = useForm({
    defaultValues: toFormValues(client),
    onSubmit: async ({ value }) => {
      await save.mutateAsync(toInput(value, client?.id));
      toast.success(client ? "Client updated" : "Client added");
      onDone();
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
