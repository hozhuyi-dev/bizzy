import { useSelector } from "@tanstack/react-form";
import { PREVIEW_DEBOUNCE_MS } from "../../sessions.constant";
import { sessionTime, toBookingValues, toSessionDraft } from "../../sessions.form";
import { SessionsQuery } from "../../sessions.query";
import type { BookingValues, PriceIs } from "../../sessions.form";
import type { CoverView, PreviewSessionRequest, SessionDraft, SessionView } from "../../sessions.types";
import type { Locks } from "~/core/lambda/lambda.types";
import { ClientsQuery } from "~/features/clients/clients.query";
import { ClientSelectField } from "~/features/clients/components/client-select-field/client-select-field.component";
import { PackagesQuery } from "~/features/packages/packages.query";
import { LockedHint } from "~/features/remedies/components/locked-hint/locked-hint.component";
import { saidAbove } from "~/features/remedies/remedies.util";
import { toastRefusal } from "~/features/remedies/components/remedy-buttons/remedy-buttons.component";
import { useAppForm } from "~/components/shared/form/form.hook";
import { UnsavedChangesDialog } from "~/components/shared/dialog/unsaved-changes-dialog/unsaved-changes-dialog.component";
import { Button } from "~/components/ui/button";
import { DialogFooter } from "~/components/ui/dialog";
import { FieldDescription, FieldGroup } from "~/components/ui/field";
import { Separator } from "~/components/ui/separator";
import { useDebounced } from "~/core/utils/debounced.hook";
import { formatDate, formatHours, toTimeInput } from "~/core/utils/date.util";
import { formatCents } from "~/core/utils/money.util";
import { moneyError, requiredError, wholeNumberError } from "~/core/utils/form.util";

const PRICE_IS_ITEMS: Array<{ value: PriceIs; label: string }> = [
  { value: "each", label: "per hour" },
  { value: "total", label: "in total" },
];

/** Usual lengths, a tap away; any other is typed. */
const LENGTHS = [30, 45, 60, 90];

interface BookingFormProps {
  initial: SessionDraft;
  /** The session being edited; omitted for a new one. */
  session?: SessionView | undefined;
  /** What its update can't change now: those fields are disabled, saying why. */
  locked?: Locks | undefined;
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
export function BookingForm({ initial, session, locked = {}, submitLabel, onSubmit, onCancel }: BookingFormProps) {
  const clientsById = ClientsQuery.useById();
  const packages = PackagesQuery.useList(true);
  // What was received follows a new fee only on a receipt not issued yet.
  const repayable = Boolean(session?.paid && !session.paid.issued);

  const form = useAppForm({
    defaultValues: toBookingValues(initial),
    onSubmit: async ({ value }) => {
      try {
        await onSubmit(toSessionDraft(value), value.updatePayment);
      } catch (error) {
        toastRefusal(error);
      }
    },
  });

  const hasChanges = useSelector(form.store, (state) => !state.isDefaultValue);

  // What would pay for it, as saving it will choose; asked once the time stops changing.
  const previewRequest = useDebounced(
    useSelector(form.store, (state) => previewOf(state.values, session)),
    PREVIEW_DEBOUNCE_MS,
  );
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
        <form.AppField
          name="clientId"
          validators={{ onChange: ({ value }) => requiredError(value, "Choose a client") }}
          listeners={{
            // A new choice of client starts from their usual place.
            onChange: ({ value }) => form.setFieldValue("homeVisit", clientsById.get(value)?.homeVisits ?? false),
          }}
        >
          {() => (
            <ClientSelectField
              keepId={session?.clientId}
              disabled={locked.clientId !== undefined}
              hint={<LockedHint lock={locked.clientId} />}
            />
          )}
        </form.AppField>

        <div className="flex flex-wrap items-start gap-4">
          <form.AppField name="date" validators={{ onChange: ({ value }) => requiredError(value, "Pick a day") }}>
            {(field) => <field.TextField label="Day" type="date" className="w-auto" />}
          </form.AppField>

          <form.AppField name="time" validators={{ onChange: ({ value }) => requiredError(value, "Pick a time") }}>
            {(field) => <field.TextField label="Start" type="time" step={300} className="w-auto" />}
          </form.AppField>

          <form.AppField name="minutes" validators={{ onChange: ({ value }) => wholeNumberError(value, 5, 720) }}>
            {(field) => <field.TextField label="Minutes" inputMode="numeric" className="w-24" />}
          </form.AppField>
        </div>
        <form.Subscribe selector={(state) => [state.values.date, state.values.time, state.values.minutes] as const}>
          {([date, time, minutes]) => (
            <div className="-mt-3 flex flex-wrap items-center gap-1">
              {LENGTHS.map((length) => (
                <Button
                  key={length}
                  type="button"
                  variant={Number(minutes) === length ? "secondary" : "outline"}
                  size="xs"
                  onClick={() => form.setFieldValue("minutes", String(length))}
                >
                  {length} min
                </Button>
              ))}
              <span className="ml-1 text-xs text-muted-foreground">{endsAt(date, time, minutes)}</span>
            </div>
          )}
        </form.Subscribe>

        <form.AppField name="homeVisit">
          {(field) => (
            <field.CheckboxField
              label="Home visit"
              description="Shown in the event's title as (V) or (H) when it isn't the client's usual place."
            />
          )}
        </form.AppField>

        <form.AppField name="tentative">
          {(field) => (
            <field.CheckboxField
              label="Not confirmed"
              description="Goes on your to-do list a few days before, to confirm with the client."
              disabled={locked.tentative !== undefined}
              hint={<LockedHint lock={locked.tentative} again={saidAbove(locked.tentative, locked.clientId)} />}
            />
          )}
        </form.AppField>

        <Separator />

        <form.AppField
          name="fee"
          validators={{
            onChangeListenTo: ["clientId", "date", "time", "minutes", "packageHours", "packagePrice", "tentative"],
            onChange: ({ value, fieldApi }) => {
              if (value.trim()) return moneyError(value);
              // A booking not yet confirmed can wait for its fee.
              return cover?.kind === "none" && !fieldApi.form.getFieldValue("tentative")
                ? "Enter the fee: no package credits or client fee cover it"
                : undefined;
            },
          }}
        >
          {(field) => (
            <form.Subscribe selector={(state) => state.values}>
              {(values) => (
                <field.TextField
                  label="Fee for this session"
                  inputMode="decimal"
                  inputClassName="max-w-40"
                  disabled={locked.fee !== undefined}
                  // The lock says why; otherwise what would pay for it.
                  description={locked.fee ? undefined : describeCover(values)}
                  hint={<LockedHint lock={locked.fee} again={saidAbove(locked.fee, locked.clientId, locked.tentative)} />}
                />
              )}
            </form.Subscribe>
          )}
        </form.AppField>

        <div className="flex flex-wrap items-start gap-4">
          <form.AppField
            name="packageHours"
            validators={{
              onChangeListenTo: ["packagePrice"],
              onChange: ({ value, fieldApi }) => {
                if (!value.trim()) {
                  return fieldApi.form.getFieldValue("packagePrice").trim() ? "How many hours?" : undefined;
                }
                return wholeNumberError(value, 1, 1000);
              },
            }}
          >
            {(field) => (
              <field.TextField
                label="Package bought"
                inputMode="numeric"
                placeholder="Hours"
                className="w-32"
                disabled={locked.package !== undefined}
              />
            )}
          </form.AppField>

          <form.AppField
            name="packagePrice"
            validators={{
              onChangeListenTo: ["packageHours"],
              onChange: ({ value, fieldApi }) =>
                moneyError(value, {
                  required: fieldApi.form.getFieldValue("packageHours").trim() ? "What does it cost?" : undefined,
                  positive: true,
                }),
            }}
          >
            {(field) => (
              <field.TextField label="Price" inputMode="decimal" className="w-32" disabled={locked.package !== undefined} />
            )}
          </form.AppField>

          <form.AppField name="packagePriceIs">
            {(field) => (
              <field.SelectField
                label={<span aria-hidden="true">&nbsp;</span>}
                aria-label="The price is"
                items={PRICE_IS_ITEMS}
                className="w-36"
                disabled={locked.package !== undefined}
              />
            )}
          </form.AppField>
        </div>
        <LockedHint
          lock={locked.package}
          again={saidAbove(locked.package, locked.clientId, locked.tentative, locked.fee)}
        />
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
        <form.AppField name="updatePayment">
          {(field) => (
            <field.CheckboxField
              label="Update the payment with a new fee"
              description="What was paid moves to the new amount, as what you collected or refunded with the change. Without it, a new fee waits for the payment to be undone."
            />
          )}
        </form.AppField>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <form.AppForm>
          <form.SubmitButton label={submitLabel} />
        </form.AppForm>
      </DialogFooter>
      <UnsavedChangesDialog when={hasChanges} />
    </form>
  );
}

/** "Until 11:00", once the day, start and length read as a time. */
function endsAt(date: string, time: string, minutes: string): string {
  const n = Number(minutes);
  if (!date || !time || !Number.isInteger(n) || n <= 0) return "";
  const end = new Date(new Date(`${date}T${time}`).getTime() + n * 60_000);
  return Number.isNaN(end.getTime()) ? "" : `Until ${toTimeInput(end)}`;
}

/** The booking to price, once it names a client and a time. */
function previewOf(values: BookingValues, session: SessionView | undefined): PreviewSessionRequest | undefined {
  if (!values.clientId || !values.date || !values.time) return undefined;
  const draft = toSessionDraft(values);
  return { clientId: draft.clientId, time: sessionTime(draft), sessionId: session?.id, buysPackage: draft.package !== undefined };
}
