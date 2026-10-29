import { useSelector } from "@tanstack/react-form";
import { PAY_BY_OPTIONS, PREVIEW_DEBOUNCE_MS } from "../../sessions.constant";
import { useDescribeCover } from "../../session-cover.hook";
import { sessionTime, toBookingValues, toSessionDraft } from "../../sessions.form";
import { SessionsQuery } from "../../sessions.query";
import type { BookingValues, PriceIs } from "../../sessions.form";
import type { CoverView, PreviewSessionRequest, SessionDraft, SessionView } from "../../sessions.types";
import type { Locks } from "~/core/lambda/lambda.types";
import { ClientsQuery } from "~/features/clients/clients.query";
import { BILLED_TO_HELP } from "~/features/clients/clients.constant";
import { pickableClients } from "~/features/clients/clients.util";
import { PaidByField, PaidOnField } from "~/features/payments/components/paid-fields/paid-fields.component";
import { ClientSelectField } from "~/features/clients/components/client-select-field/client-select-field.component";
import { LockedHint } from "~/features/remedies/components/locked-hint/locked-hint.component";
import { saidAbove } from "~/features/remedies/remedies.util";
import { toastRefusal } from "~/features/remedies/components/remedy-buttons/remedy-buttons.component";
import { useAppForm } from "~/components/shared/form/form.hook";
import { Button } from "~/components/ui/button";
import { FieldDescription, FieldGroup } from "~/components/ui/field";
import { Separator } from "~/components/ui/separator";
import { useDebounced } from "~/core/utils/debounced.hook";
import { formatHours, toTimeInput } from "~/core/utils/date.util";
import { centsToInput, formatCents } from "~/core/utils/money.util";
import { moneyError, requiredError, wholeNumberError } from "~/core/utils/form.util";

const PRICE_IS_ITEMS: Array<{ value: PriceIs; label: string }> = [
  { value: "each", label: "per hour" },
  { value: "total", label: "in total" },
];

/** Usual lengths, a tap away; any other is typed. */
const LENGTHS = [30, 45, 60, 90];

interface BookingFormOptions {
  initial: SessionDraft;
  /** The session being edited; omitted for a new one. */
  session?: SessionView | undefined;
  /** What its update can't change now: those fields are disabled, saying why. */
  locked?: Locks | undefined;
  /**
   * Resolves once saved; a refusal is shown with its remedies and leaves
   * the form as it is. updatePayment moves what was received to the new
   * amounts.
   */
  onSubmit: (draft: SessionDraft, updatePayment: boolean) => Promise<void>;
}

/**
 * When and with whom, and, for a new one, how it is paid: everything the
 * calendar event shows (afterwards, how it is paid changes on its Payment
 * step). The user fills in fields; the API writes the event, so its title
 * always reads back as this booking. Its fields go in the page's Booking
 * step (a new session's, or a session's own while it is being changed),
 * and its Save in the page header, so the page wraps the fields in a form
 * with the header's submit pointing at it (`form.handleSubmit`).
 */
export function useBookingForm({ initial, session, locked = {}, onSubmit }: BookingFormOptions) {
  const clientsById = ClientsQuery.useById();
  const clients = ClientsQuery.useList();
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
  const submitting = useSelector(form.store, (state) => state.isSubmitting);

  // What would pay for it, as saving it will choose; asked once the time stops changing.
  const previewRequest = useDebounced(
    useSelector(form.store, (state) => previewOf(state.values, session)),
    PREVIEW_DEBOUNCE_MS,
  );
  const preview = SessionsQuery.usePreview(previewRequest);
  const cover: CoverView | undefined = previewRequest ? preview.data : undefined;

  const describeCover = useDescribeCover();

  // Who can pay: every client (whoever pays now kept, archived or not), or whom the client is billed to.
  const payers = pickableClients(clients.data ?? [], session?.payer);
  const usualPayerName = cover ? clientsById.get(cover.payer)?.name : undefined;
  const usualPayer = usualPayerName ? `As usual: ${usualPayerName}` : "As usual";
  const fields = (
    <>
      <FieldGroup>
        <form.AppField
          name="clientId"
          validators={{ onChange: ({ value }) => requiredError(value, "Choose a client") }}
          listeners={{
            // A new choice of client starts from their usual place, billed as they usually are.
            onChange: ({ value }) => {
              form.setFieldValue("homeVisit", clientsById.get(value)?.homeVisits ?? false);
              form.setFieldValue("billTo", "");
            },
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

        <div className="grid grid-cols-[minmax(0,5fr)_minmax(0,4fr)_4.5rem] items-start gap-3 sm:grid-cols-[10rem_8rem_5rem] sm:gap-4">
          <form.AppField name="date" validators={{ onChange: ({ value }) => requiredError(value, "Pick a day") }}>
            {(field) => <field.TextField label="Day" type="date" />}
          </form.AppField>

          <form.AppField name="time" validators={{ onChange: ({ value }) => requiredError(value, "Pick a time") }}>
            {(field) => <field.TextField label="Start" type="time" step={300} />}
          </form.AppField>

          <form.AppField name="minutes" validators={{ onChange: ({ value }) => wholeNumberError(value, 5, 720) }}>
            {(field) => <field.TextField label="Minutes" inputMode="numeric" />}
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

        {/* A new one only: afterwards how it is paid changes on its Payment step. */}
        {!session && (
          <form.Subscribe selector={(state) => state.values}>
            {(values) => (
              <>
                <form.AppField
                  name="payBy"
                  validators={{
                    onChangeListenTo: ["clientId", "date", "time", "minutes", "packageHours", "packagePrice", "tentative"],
                    // A booking not yet confirmed can wait for what pays for it.
                    onChange: ({ fieldApi }) =>
                      cover?.by === "package" && cover.kind === "none" && !fieldApi.form.getFieldValue("tentative")
                        ? "Package credits don't cover it, and there's no usual fee: pay it by its fee"
                        : undefined,
                  }}
                >
                  {(field) => (
                    <field.ChoiceField
                      label="Paid by"
                      options={PAY_BY_OPTIONS}
                      fallback={cover?.by}
                      description={(values.payBy || cover?.by) === "fee" ? undefined : describeCover(cover, values.clientId)}
                    />
                  )}
                </form.AppField>
                {(values.payBy || cover?.by) === "fee" && (
                  <form.AppField
                    name="fee"
                    validators={{
                      onChangeListenTo: ["clientId", "date", "time", "minutes", "tentative", "payBy"],
                      onChange: ({ value, fieldApi }) => {
                        if (value.trim()) return moneyError(value);
                        return cover?.by === "fee" && cover.kind === "none" && !fieldApi.form.getFieldValue("tentative")
                          ? "Enter the fee: the client has no usual fee"
                          : undefined;
                      },
                    }}
                  >
                    {(field) => (
                      <field.TextField
                        label="Fee for this session"
                        inputMode="decimal"
                        inputClassName="max-w-40"
                        placeholder={cover?.feeCents === undefined ? undefined : centsToInput(cover.feeCents)}
                        description={describeCover(cover, values.clientId, Boolean(values.fee.trim()))}
                      />
                    )}
                  </form.AppField>
                )}
              </>
            )}
          </form.Subscribe>
        )}

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
        <LockedHint lock={locked.package} again={saidAbove(locked.package, locked.clientId, locked.tentative)} />
        <form.Subscribe selector={(state) => state.values}>
          {(values) => {
            const pkg = toSessionDraft(values).package;
            return (
              <FieldDescription>
                {pkg
                  ? `${formatHours(pkg.hours)} for ${formatCents(pkg.priceCents)} (${formatCents(Math.round(pkg.priceCents / pkg.hours))} an hour), due with this session, which uses its credits once older packages' run out unless it is paid by its fee.`
                  : "Only if one is bought in this session, as hours; it uses the credits older packages leave."}
              </FieldDescription>
            );
          }}
        </form.Subscribe>

        <form.AppField name="billTo">
          {(field) => (
            <field.SelectField
              label="Billed to"
              items={[{ value: "", label: usualPayer }, ...payers]}
              className="max-w-72"
              disabled={locked.billTo !== undefined}
              description={BILLED_TO_HELP}
              hint={<LockedHint lock={locked.billTo} again={saidAbove(locked.billTo, locked.package)} />}
            />
          )}
        </form.AppField>

        {/* A new one only: afterwards it is marked paid on its page. Not one to confirm, which waits for it. */}
        {!session && (
          <form.Subscribe selector={(state) => [state.values.tentative, state.values.paidBy] as const}>
            {([tentative, paidBy]) =>
              !tentative && (
                <>
                  <form.AppField name="paidBy">
                    {() => (
                      <PaidByField
                        notYet
                        description="Paid there and then, in full with a package bought in it; nothing is recorded when package credits pay for it."
                      />
                    )}
                  </form.AppField>
                  {paidBy && (
                    <form.AppField
                      name="paidOn"
                      validators={{ onChange: ({ value }) => requiredError(value, "Choose the day it was paid") }}
                    >
                      {() => <PaidOnField />}
                    </form.AppField>
                  )}
                </>
              )
            }
          </form.Subscribe>
        )}
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

    </>
  );

  return { form, fields, hasChanges, submitting };
}

/** "Until 11:00", once the day, start and length read as a time. */
function endsAt(date: string, time: string, minutes: string): string {
  const n = Number(minutes);
  if (!date || !time || !Number.isInteger(n) || n <= 0) return "";
  const end = new Date(new Date(`${date}T${time}`).getTime() + n * 60_000);
  return Number.isNaN(end.getTime()) ? "" : `Until ${toTimeInput(end)}`;
}

/** The booking to price, once it names a client and a time, paid as chosen (as a new one is, until then). */
function previewOf(values: BookingValues, session: SessionView | undefined): PreviewSessionRequest | undefined {
  if (!values.clientId || !values.date || !values.time) return undefined;
  const draft = toSessionDraft(values);
  return {
    clientId: draft.clientId,
    time: sessionTime(draft),
    sessionId: session?.id,
    buysPackage: draft.package !== undefined,
    pay: draft.payBy ? { by: draft.payBy } : undefined,
  };
}
