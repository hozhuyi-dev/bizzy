import { useSelector } from "@tanstack/react-form";
import { PAY_BY_OPTIONS } from "../../sessions.constant";
import { toPayFields, toPayValues } from "../../sessions.form";
import { SessionsQuery } from "../../sessions.query";
import { useDescribeCover } from "../../session-cover.hook";
import type { PayValues } from "../../sessions.form";
import type { PayOption, SessionFields, SessionFullView } from "../../sessions.types";
import { ClientsQuery } from "~/features/clients/clients.query";
import { LockedHint } from "~/features/remedies/components/locked-hint/locked-hint.component";
import { saidAbove } from "~/features/remedies/remedies.util";
import { toastRefusal } from "~/features/remedies/components/remedy-buttons/remedy-buttons.component";
import { useAppForm } from "~/components/shared/form/form.hook";
import { FieldGroup } from "~/components/ui/field";
import { formatDate, formatHours } from "~/core/utils/date.util";
import { centsToInput } from "~/core/utils/money.util";
import { moneyError } from "~/core/utils/form.util";

interface PayFormOptions {
  session: SessionFullView;
  /** Resolves once saved; a refusal is shown with its remedies and leaves the form as it is. */
  onSubmit: (fields: SessionFields, values: PayValues) => Promise<void>;
}

/**
 * How a session is paid, changed on its Payment step: by package (the
 * oldest bought by its start, or one chosen, whenever it was bought) or by
 * its own fee (typed, or the client's usual one). What saving would do is
 * the API's preview, said under the choice. A session paid, or on an
 * issued document, keeps how it is paid (`locked.pay`), saying what to
 * undo first. The page puts its fields in the step and its Save in the
 * header, as the booking's.
 */
export function usePayForm({ session, onSubmit }: PayFormOptions) {
  const clientsById = ClientsQuery.useById();
  const describeCover = useDescribeCover();
  const { locked } = session;
  // What was received follows a new fee only on a receipt not issued yet.
  const repayable = Boolean(session.paid && !session.paid.issued);

  const form = useAppForm({
    defaultValues: toPayValues(session),
    onSubmit: async ({ value }) => {
      try {
        await onSubmit(toPayFields(value, session), value);
      } catch (error) {
        toastRefusal(error);
      }
    },
  });
  const hasChanges = useSelector(form.store, (state) => !state.isDefaultValue);
  const submitting = useSelector(form.store, (state) => state.isSubmitting);

  const by = useSelector(form.store, (state) => state.values.by);
  const packageId = useSelector(form.store, (state) => state.values.packageId);
  const preview = SessionsQuery.usePreview({
    clientId: session.clientId,
    time: { start: session.start, end: session.end },
    sessionId: session.id,
    buysPackage: Boolean(session.bought),
    pay: by === "package" ? { by, ...(packageId ? { packageId } : {}) } : { by },
  });
  const cover = preview.data;

  const name = (clientId: string) => clientsById.get(clientId)?.name ?? "Someone";
  const packageLabel = (option: PayOption) =>
    [
      `${name(option.clientId)}'s, bought ${formatDate(option.purchasedAt)}`,
      `${formatHours(option.hoursLeft)} left`,
      option.after ? "after this session" : undefined,
    ]
      .filter(Boolean)
      .join(" · ");
  const packages = [
    { value: "", label: "Oldest first" },
    ...session.payOptions.map((option) => ({ value: option.packageId, label: packageLabel(option) })),
  ];

  const fields = (
    <FieldGroup>
      <form.AppField name="by">
        {(field) => (
          <field.ChoiceField
            label="Paid by"
            options={PAY_BY_OPTIONS}
            disabled={locked.pay !== undefined}
            hint={<LockedHint lock={locked.pay} />}
          />
        )}
      </form.AppField>
      <form.Subscribe selector={(state) => state.values}>
        {(values) =>
          values.by === "package" ? (
            <form.AppField name="packageId">
              {(field) => (
                <field.SelectField
                  label="Package"
                  items={packages}
                  className="max-w-md"
                  disabled={locked.pay !== undefined}
                  description={
                    session.payOptions.length === 0
                      ? `${name(session.clientId)} has no package with hours left for it.`
                      : describeCover(cover, session.clientId)
                  }
                />
              )}
            </form.AppField>
          ) : (
            <form.AppField name="fee" validators={{ onChange: ({ value }) => (value.trim() ? moneyError(value) : undefined) }}>
              {(field) => (
                <field.TextField
                  label="Fee for this session"
                  inputMode="decimal"
                  inputClassName="max-w-40"
                  placeholder={cover?.feeCents === undefined ? undefined : centsToInput(cover.feeCents)}
                  disabled={locked.fee !== undefined}
                  description={locked.fee ? undefined : describeCover(cover, session.clientId, Boolean(values.fee.trim()))}
                  hint={<LockedHint lock={locked.fee} again={saidAbove(locked.fee, locked.pay)} />}
                />
              )}
            </form.AppField>
          )
        }
      </form.Subscribe>
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
    </FieldGroup>
  );

  return { form, fields, hasChanges, submitting };
}
