import { useState } from "react";
import { useForm, useStore } from "@tanstack/react-form";
import { sessionTime, toBookingValues, toSessionDraft } from "../../sessions.form";
import { SessionsQuery } from "../../sessions.query";
import type { BookingValues, PriceIs } from "../../sessions.form";
import type { CoverView, PreviewSessionRequest, SessionDraft, SessionView } from "../../sessions.types";
import { ClientsQuery } from "~/features/clients/clients.query";
import { PackagesQuery } from "~/features/packages/packages.query";
import { toastRefusal } from "~/features/remedies/components/remedy-buttons/remedy-buttons.component";
import { UnsavedChangesPrompt } from "~/components/shared/unsaved-changes-prompt/unsaved-changes-prompt.component";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { DialogFooter } from "~/components/ui/dialog";
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Separator } from "~/components/ui/separator";
import { formatDate, formatHours } from "~/core/utils/date.util";
import { formatCents, parseCents } from "~/core/utils/money.util";
import { fieldErrors } from "~/core/utils/form.util";

const PRICE_IS_ITEMS: Array<{ value: PriceIs; label: string }> = [
  { value: "each", label: "per hour" },
  { value: "total", label: "in total" },
];

interface BookingFormProps {
  initial: SessionDraft;
  /** The session being edited; omitted for a new one. */
  session?: SessionView | undefined;
  submitLabel: string;
  /**
   * Resolves once saved; a refusal is shown with its remedies and leaves
   * the form as it is. updatePayment moves what was received to the new
   * amounts.
   */
  onSubmit: (draft: SessionDraft, updatePayment: boolean) => Promise<void>;
  onCancel: () => void;
}

/**
 * When and with whom, and what it costs: everything the calendar event
 * shows. The user fills in fields; the API writes the event, so its title
 * always reads back as this booking. Laid out for a dialog: its buttons sit
 * in the dialog's footer.
 */
export function BookingForm({ initial, session, submitLabel, onSubmit, onCancel }: BookingFormProps) {
  const clients = ClientsQuery.useList();
  const clientsById = ClientsQuery.useById();
  const packages = PackagesQuery.useList(true);
  // What was received follows a new fee only on a receipt not issued yet.
  const repayable = Boolean(session?.paid && !session.paid.issued);
  const [updatePayment, setUpdatePayment] = useState(false);

  const form = useForm({
    defaultValues: toBookingValues(initial),
    onSubmit: async ({ value }) => {
      try {
        await onSubmit(toSessionDraft(value), updatePayment);
      } catch (error) {
        toastRefusal(error);
      }
    },
  });

  const hasChanges = useStore(form.store, (state) => !state.isDefaultValue);

  const items = (clients.data ?? [])
    .map((client) => ({ value: client.id, label: client.name }))
    .sort((a, b) => a.label.localeCompare(b.label));

  // What would pay for it, as saving it will choose.
  const previewRequest = useStore(form.store, (state) => previewOf(state.values, session));
  const preview = SessionsQuery.usePreview(previewRequest);
  const cover: CoverView | undefined = previewRequest ? preview.data : undefined;

  const describeCover = (values: BookingValues): string => {
    const name = clientsById.get(values.clientId)?.name;
    if (!name) return "Choose a client to see what covers it.";
    if (!cover) return "Working out what covers it…";
    const prefix = values.fee.trim() ? `Its whole fee, in place of` : "Leave blank to use";
    const credits = cover.credits
      .map(({ packageId, hours }) => {
        const pkg = packages.data?.find((p) => p.id === packageId);
        return pkg
          ? `${formatHours(hours)} of ${name}'s package bought ${formatDate(pkg.purchasedAt)} (${formatHours(pkg.creditsLeft)} left)`
          : `${formatHours(hours)} of ${name}'s package credits`;
      })
      .join(", then ");
    const then = credits ? `${credits}, then ` : "";
    const charged = `Charged as ${formatHours(cover.hours)}.`;
    switch (cover.kind) {
      case "bought":
        return `${charged} ${prefix} ${then}the package bought in this session.`;
      case "credit":
        return `${charged} ${prefix} ${credits}.`;
      case "default":
        return `${charged} ${prefix} ${then}${name}'s usual fee for ${formatHours(cover.feeHours)}: ${formatCents(cover.feeCents ?? 0)}.`;
      case "none":
        return credits
          ? `${charged} ${credits} leaves ${formatHours(cover.feeHours)}, and ${name} has no fee set.`
          : `${charged} ${name} has no package credits left and no fee set.`;
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
                onValueChange={(value) => field.handleChange(value ?? "")}
              >
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

        <div className="flex flex-wrap gap-4">
          <form.Field name="date" validators={{ onChange: ({ value }) => (value ? undefined : "Pick a day") }}>
            {(field) => (
              <Field data-invalid={field.state.meta.errors.length > 0} className="w-auto">
                <FieldLabel htmlFor={field.name}>Day</FieldLabel>
                <Input
                  id={field.name}
                  type="date"
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
                checked={field.state.value}
                onCheckedChange={(checked) => field.handleChange(checked)}
              />
              <FieldContent>
                <FieldLabel htmlFor={field.name}>Home visit</FieldLabel>
                <FieldDescription>Shown in the event's title as (V) or (H) when it isn't the client's usual place.</FieldDescription>
              </FieldContent>
            </Field>
          )}
        </form.Field>

        <form.Field name="tentative">
          {(field) => (
            <Field orientation="horizontal">
              <Checkbox
                id={field.name}
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
            onChangeListenTo: ["clientId", "date", "time", "minutes", "packageHours", "packagePrice", "tentative"],
            onChange: ({ value, fieldApi }) => {
              if (value.trim()) return parseCents(value) !== null ? undefined : "Like 95 or 95.50";
              // A booking not yet confirmed can wait for its fee.
              return cover?.kind === "none" && !fieldApi.form.getFieldValue("tentative")
                ? "Enter the fee: no package credits or client fee cover it"
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
            name="packageHours"
            validators={{
              onChangeListenTo: ["packagePrice"],
              onChange: ({ value, fieldApi }) => {
                if (!value.trim()) {
                  return fieldApi.form.getFieldValue("packagePrice").trim() ? "How many hours?" : undefined;
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
                  placeholder="Hours"
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
              onChangeListenTo: ["packageHours"],
              onChange: ({ value, fieldApi }) => {
                if (!value.trim()) {
                  return fieldApi.form.getFieldValue("packageHours").trim() ? "What does it cost?" : undefined;
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
                  ? `${formatHours(pkg.hours)} for ${formatCents(pkg.priceCents)} (${formatCents(Math.round(pkg.priceCents / pkg.hours))} an hour), due with this session, which uses its credits once older packages' run out.`
                  : "Only if one is bought in this session, as hours; it uses the credits older packages leave."}
              </FieldDescription>
            );
          }}
        </form.Subscribe>
      </FieldGroup>

      {repayable && (
        <Field orientation="horizontal">
          <Checkbox id="update-payment" checked={updatePayment} onCheckedChange={setUpdatePayment} />
          <FieldContent>
            <FieldLabel htmlFor="update-payment">Update the payment with a new fee</FieldLabel>
            <FieldDescription>
              What was paid moves to the new amount, as what you collected or refunded with the change. Without it, a
              new fee waits for the payment to be undone.
            </FieldDescription>
          </FieldContent>
        </Field>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>
          {([canSubmit, isSubmitting]) => (
            <Button type="submit" disabled={!canSubmit || isSubmitting}>
              {isSubmitting ? "Saving…" : submitLabel}
            </Button>
          )}
        </form.Subscribe>
      </DialogFooter>
      <UnsavedChangesPrompt when={hasChanges} />
    </form>
  );
}

/** The booking to price, once it names a client and a time. */
function previewOf(values: BookingValues, session: SessionView | undefined): PreviewSessionRequest | undefined {
  if (!values.clientId || !values.date || !values.time) return undefined;
  const draft = toSessionDraft(values);
  return { clientId: draft.clientId, time: sessionTime(draft), sessionId: session?.id, buysPackage: draft.package !== undefined };
}
