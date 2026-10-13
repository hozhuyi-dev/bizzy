import { useForm, useStore } from "@tanstack/react-form";
import { toBookingValues, toSessionDraft } from "../../sessions.form";
import type { BookingValues, PriceIs } from "../../sessions.form";
import type { Session, SessionDraft } from "../../sessions.types";
import type { Cover, PreviewInput } from "~/features/billing/billing.types";
import { ClientsQuery } from "~/features/clients/clients.query";
import { PackagesQuery } from "~/features/packages/packages.query";
import { BillingQuery } from "~/features/billing/billing.query";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Separator } from "~/components/ui/separator";
import { formatDate } from "~/core/utils/date.util";
import { formatCents, parseCents } from "~/core/utils/money.util";
import { fieldErrors } from "~/core/utils/form.util";

const PRICE_IS_ITEMS: Array<{ value: PriceIs; label: string }> = [
  { value: "each", label: "per session" },
  { value: "total", label: "in total" },
];

interface BookingFormProps {
  initial: SessionDraft;
  /** The session being edited; omitted for a new one. */
  session?: Session | undefined;
  /** A document covers it: shown, not editable. */
  locked?: boolean;
  submitLabel: string;
  /** Resolves once saved; a rejection leaves the form as it is. */
  onSubmit: (draft: SessionDraft) => Promise<void>;
  /** Shown beside the submit button, e.g. Cancel. */
  extraActions?: React.ReactNode;
}

/**
 * When and with whom, and what it costs: everything written in the
 * calendar. She fills in fields; the API writes the title, so it always
 * parses and matches the client.
 */
export function BookingForm({ initial, session, locked = false, submitLabel, onSubmit, extraActions }: BookingFormProps) {
  const clients = ClientsQuery.useList();
  const clientsById = ClientsQuery.useById();
  const packages = PackagesQuery.useList(true);

  const form = useForm({
    defaultValues: toBookingValues(initial),
    onSubmit: async ({ value }) => {
      try {
        await onSubmit(toSessionDraft(value));
      } catch {
        // The caller shows what went wrong.
      }
    },
  });

  const items = (clients.data ?? [])
    .map((client) => ({ value: client.id, label: client.name }))
    .sort((a, b) => a.label.localeCompare(b.label));

  // What would pay for it, as the reconcile will price it once saved.
  const previewInput = useStore(form.store, (state) => previewOf(state.values, session));
  const preview = BillingQuery.usePreview(previewInput);
  const cover: Cover | undefined = previewInput ? preview.data : undefined;

  const describeCover = (values: BookingValues): string => {
    const name = clientsById.get(values.clientId)?.name;
    if (!name) return "Choose a client to see what covers it.";
    if (!cover) return "Working out what covers it…";
    const prefix = values.fee.trim() ? "Takes priority over" : "Leave blank to use";
    switch (cover.kind) {
      case "bought":
        return `${prefix} the package bought in this session.`;
      case "credit": {
        const { packageId } = cover;
        const pkg = packages.data?.find((p) => p.id === packageId);
        if (!pkg) return `${prefix} a credit of one of ${name}'s packages.`;
        return `${prefix} ${name}'s package bought ${formatDate(pkg.purchasedAt)}: ${pkg.creditsLeft} of ${pkg.sessions} credits left.`;
      }
      case "default":
        return `${prefix} ${name}'s fee of ${formatCents(cover.feeCents)}; no package credits left.`;
      case "none":
        return `${name} has no package credits left and no fee set.`;
    }
  };

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <FieldGroup>
        <form.Field
          name="clientId"
          validators={{ onChange: ({ value }) => (value ? undefined : "Choose a client") }}
          listeners={{
            // A new choice of client starts from their usual place.
            onChange: ({ value }) => form.setFieldValue("homeVisit", clientsById.get(value)?.homeVisits ?? false),
          }}
        >
          {(field) => (
            <Field data-invalid={field.state.meta.errors.length > 0}>
              <FieldLabel>Client</FieldLabel>
              <Select
                items={items}
                value={field.state.value}
                disabled={locked}
                onValueChange={(value) => field.handleChange(value ?? "")}
              >
                <SelectTrigger className="w-full max-w-sm">
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
              {session && <FieldDescription>In the calendar as “{session.title}”.</FieldDescription>}
              <FieldError errors={fieldErrors(field.state.meta.errors)} />
            </Field>
          )}
        </form.Field>

        <div className="flex flex-wrap gap-4">
          <form.Field name="date" validators={{ onChange: ({ value }) => (value ? undefined : "Pick a day") }}>
            {(field) => (
              <Field data-invalid={field.state.meta.errors.length > 0} className="w-auto">
                <FieldLabel htmlFor={field.name}>Day</FieldLabel>
                <Input
                  id={field.name}
                  type="date"
                  disabled={locked}
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
                <FieldError errors={fieldErrors(field.state.meta.errors)} />
              </Field>
            )}
          </form.Field>

          <form.Field name="time" validators={{ onChange: ({ value }) => (value ? undefined : "Pick a time") }}>
            {(field) => (
              <Field data-invalid={field.state.meta.errors.length > 0} className="w-auto">
                <FieldLabel htmlFor={field.name}>Start</FieldLabel>
                <Input
                  id={field.name}
                  type="time"
                  step={300}
                  disabled={locked}
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
                <FieldError errors={fieldErrors(field.state.meta.errors)} />
              </Field>
            )}
          </form.Field>

          <form.Field
            name="minutes"
            validators={{
              onChange: ({ value }) =>
                /^\d+$/.test(value.trim()) && Number(value) >= 5 && Number(value) <= 720 ? undefined : "5 to 720",
            }}
          >
            {(field) => (
              <Field data-invalid={field.state.meta.errors.length > 0} className="w-24">
                <FieldLabel htmlFor={field.name}>Minutes</FieldLabel>
                <Input
                  id={field.name}
                  inputMode="numeric"
                  disabled={locked}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
                <FieldError errors={fieldErrors(field.state.meta.errors)} />
              </Field>
            )}
          </form.Field>
        </div>

        <form.Field name="homeVisit">
          {(field) => (
            <Field orientation="horizontal">
              <Checkbox
                id={field.name}
                disabled={locked}
                checked={field.state.value}
                onCheckedChange={(checked) => field.handleChange(checked)}
              />
              <FieldContent>
                <FieldLabel htmlFor={field.name}>Home visit</FieldLabel>
                <FieldDescription>Saved as the event's colour.</FieldDescription>
              </FieldContent>
            </Field>
          )}
        </form.Field>

        <form.Field name="tentative">
          {(field) => (
            <Field orientation="horizontal">
              <Checkbox
                id={field.name}
                disabled={locked}
                checked={field.state.value}
                onCheckedChange={(checked) => field.handleChange(checked)}
              />
              <FieldContent>
                <FieldLabel htmlFor={field.name}>Not confirmed</FieldLabel>
                <FieldDescription>Goes on your to-do list a few days before, to confirm with the client.</FieldDescription>
              </FieldContent>
            </Field>
          )}
        </form.Field>

        <Separator />

        <form.Field
          name="fee"
          validators={{
            onChangeListenTo: ["clientId", "date", "time", "packageSessions", "packagePrice"],
            onChange: ({ value }) => {
              if (value.trim()) return parseCents(value) !== null ? undefined : "Like 95 or 95.50";
              return cover?.kind === "none"
                ? "Enter the fee: no package credit or client fee covers it"
                : undefined;
            },
          }}
        >
          {(field) => (
            <Field data-invalid={field.state.meta.errors.length > 0}>
              <FieldLabel htmlFor={field.name}>Fee for this session</FieldLabel>
              <Input
                id={field.name}
                inputMode="decimal"
                disabled={locked}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
                className="max-w-40"
              />
              <form.Subscribe selector={(state) => state.values}>
                {(values) => <FieldDescription>{describeCover(values)}</FieldDescription>}
              </form.Subscribe>
              <FieldError errors={fieldErrors(field.state.meta.errors)} />
            </Field>
          )}
        </form.Field>

        <div className="flex flex-wrap items-start gap-4">
          <form.Field
            name="packageSessions"
            validators={{
              onChangeListenTo: ["packagePrice"],
              onChange: ({ value, fieldApi }) => {
                if (!value.trim()) {
                  return fieldApi.form.getFieldValue("packagePrice").trim() ? "How many sessions?" : undefined;
                }
                return /^\d+$/.test(value.trim()) && Number(value) >= 1 && Number(value) <= 1000
                  ? undefined
                  : "1 to 1000";
              },
            }}
          >
            {(field) => (
              <Field data-invalid={field.state.meta.errors.length > 0} className="w-32">
                <FieldLabel htmlFor={field.name}>Package bought</FieldLabel>
                <Input
                  id={field.name}
                  inputMode="numeric"
                  placeholder="Sessions"
                  disabled={locked}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
                <FieldError errors={fieldErrors(field.state.meta.errors)} />
              </Field>
            )}
          </form.Field>

          <form.Field
            name="packagePrice"
            validators={{
              onChangeListenTo: ["packageSessions"],
              onChange: ({ value, fieldApi }) => {
                if (!value.trim()) {
                  return fieldApi.form.getFieldValue("packageSessions").trim() ? "What does it cost?" : undefined;
                }
                const cents = parseCents(value);
                return cents !== null && cents > 0 ? undefined : "Like 180 or 1800";
              },
            }}
          >
            {(field) => (
              <Field data-invalid={field.state.meta.errors.length > 0} className="w-32">
                <FieldLabel htmlFor={field.name}>Price</FieldLabel>
                <Input
                  id={field.name}
                  inputMode="decimal"
                  disabled={locked}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
                <FieldError errors={fieldErrors(field.state.meta.errors)} />
              </Field>
            )}
          </form.Field>

          <form.Field name="packagePriceIs">
            {(field) => (
              <Field className="w-36">
                <FieldLabel aria-hidden="true">&nbsp;</FieldLabel>
                <Select
                  items={PRICE_IS_ITEMS}
                  value={field.state.value}
                  disabled={locked}
                  onValueChange={(value) => value && field.handleChange(value)}
                >
                  <SelectTrigger className="w-full" aria-label="The price is">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRICE_IS_ITEMS.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
          </form.Field>
        </div>
        <form.Subscribe selector={(state) => state.values}>
          {(values) => {
            const pkg = toSessionDraft(values).package;
            return (
              <FieldDescription>
                {pkg
                  ? `${pkg.sessions} sessions for ${formatCents(pkg.priceCents)} (${formatCents(Math.round(pkg.priceCents / pkg.sessions))} each), due with this session, which uses the first.`
                  : "Only if one is bought in this session; it uses the first credit."}
              </FieldDescription>
            );
          }}
        </form.Subscribe>
      </FieldGroup>

      {!locked && (
        <div className="flex flex-wrap items-center gap-2">
          <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>
            {([canSubmit, isSubmitting]) => (
              <Button type="submit" disabled={!canSubmit || isSubmitting}>
                {isSubmitting ? "Saving…" : submitLabel}
              </Button>
            )}
          </form.Subscribe>
          {extraActions}
        </div>
      )}
    </form>
  );
}

/** The booking to price, once it names a client and a time. */
function previewOf(values: BookingValues, session: Session | undefined): PreviewInput | undefined {
  if (!values.clientId || !values.date || !values.time) return undefined;
  const draft = toSessionDraft(values);
  return { clientId: draft.clientId, start: draft.start, eventId: session?.eventId, buysPackage: draft.package !== undefined };
}
