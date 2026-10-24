import { toast } from "sonner";
import { PaymentsMutation } from "../../payments.mutation";
import { PAYMENT_CHOICES } from "../../payments.constant";
import { methodLabel } from "../../payments.util";
import type { Payable, PaymentMethod } from "../../payments.types";
import { toastRefusal } from "~/features/remedies/components/remedy-buttons/remedy-buttons.component";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { DialogFooter } from "~/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "~/components/ui/field";
import { useAppForm } from "~/components/shared/form/form.hook";
import { fieldErrors, requiredError } from "~/core/utils/form.util";
import { formatDate, todayISO } from "~/core/utils/date.util";
import { formatCents } from "~/core/utils/money.util";

const keyOf = (p: Payable) => `${p.item.kind}:${p.item.id}:${p.paid ? "paid" : "owed"}`;

/**
 * What was received for each item, and a form for what is still owed.
 * Clients pay in full: each item is paid all it owes. A payment is a draft
 * receipt until it is issued; after that, it stays as issued. One recorded
 * by mistake is undone, and recorded again. In a dialog (`onCancel`), Mark
 * paid is in its footer, beside Cancel.
 */
export function PaymentPanel({
  payables,
  onPaid,
  onCancel,
}: {
  payables: ReadonlyArray<Payable>;
  /** After recording what was owed. */
  onPaid?: () => void;
  /** In a dialog: closes it, from Cancel in its footer. */
  onCancel?: () => void;
}) {
  const paid = payables.filter((p) => p.paid);
  const owed = payables.filter((p) => !p.paid && p.dueCents > 0);

  return (
    <div className="flex flex-col gap-4">
      {paid.map((p) => (
        <PaymentSummary key={keyOf(p)} payable={p} showLabel={payables.length > 1} />
      ))}
      {owed.length > 0 && (
        <PaymentForm key={owed.map(keyOf).join()} payables={owed} onDone={onPaid} onCancel={onCancel} />
      )}
    </div>
  );
}

function PaymentSummary({ payable, showLabel }: { payable: Payable; showLabel: boolean }) {
  const setPayment = PaymentsMutation.useSet();
  const { paid } = payable;
  if (!paid) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm">
        {showLabel && <span className="text-muted-foreground">{payable.label}: </span>}
        <b>{formatCents(paid.amountCents)}</b> paid by {methodLabel(paid.method)} on {formatDate(paid.paidOn)}
      </p>
      {paid.issued ? (
        <span className="text-xs text-muted-foreground">On an issued receipt.</span>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          disabled={setPayment.isPending}
          onClick={() =>
            setPayment.mutate(
              { items: [payable.item], payment: null },
              { onSuccess: () => toast.success("Payment undone"), onError: toastRefusal },
            )
          }
        >
          Undo
        </Button>
      )}
    </div>
  );
}

interface PaymentFormProps {
  payables: ReadonlyArray<Payable>;
  onDone?: (() => void) | undefined;
  onCancel?: (() => void) | undefined;
}

interface PaymentValues {
  /** The payables ticked, by keyOf. */
  chosen: Array<string>;
  /** Blank until one is picked. */
  method: PaymentMethod | "";
  paidOn: string;
}

function PaymentForm({ payables, onDone, onCancel }: PaymentFormProps) {
  const setPayment = PaymentsMutation.useSet();
  const [first] = payables;
  const single = payables.length === 1;

  const defaultValues: PaymentValues = { chosen: payables.map(keyOf), method: "", paidOn: todayISO() };
  const form = useAppForm({
    defaultValues,
    onSubmit: async ({ value }) => {
      const selected = payables.filter((p) => value.chosen.includes(keyOf(p)));
      const total = selected.reduce((sum, p) => sum + p.dueCents, 0);
      if (!value.method) return;
      try {
        await setPayment.mutateAsync({
          items: selected.map((p) => p.item),
          payment: { method: value.method, paidOn: value.paidOn },
        });
        toast.success(`${formatCents(total)} paid by ${methodLabel(value.method)}`);
        onDone?.();
      } catch (error) {
        toastRefusal(error);
      }
    },
  });

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      {single && first ? (
        <p className="text-sm">
          <b>{formatCents(first.dueCents)}</b> for the {first.label.toLowerCase()}
        </p>
      ) : (
        <form.Field
          name="chosen"
          validators={{ onChange: ({ value }) => (value.length === 0 ? "Choose what was paid" : undefined) }}
        >
          {(field) => {
            const total = payables.filter((p) => field.state.value.includes(keyOf(p))).reduce((sum, p) => sum + p.dueCents, 0);
            const invalid = field.state.meta.errors.length > 0;
            return (
              <Field data-invalid={invalid}>
                <FieldLabel id="payment-items">Paying for</FieldLabel>
                <ul aria-labelledby="payment-items" className="flex flex-col gap-2 text-sm">
                  {payables.map((p) => {
                    const k = keyOf(p);
                    const id = `pay-${k.replaceAll(":", "-")}`;
                    return (
                      <li key={k} className="flex items-center gap-2">
                        <Checkbox
                          id={id}
                          checked={field.state.value.includes(k)}
                          onCheckedChange={(checked) =>
                            field.handleChange((current) => (checked ? [...current, k] : current.filter((c) => c !== k)))
                          }
                        />
                        <label htmlFor={id} className="flex grow justify-between gap-2">
                          <span>{p.label}</span>
                          <span className="tabular-nums">{formatCents(p.dueCents)}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
                {invalid ? (
                  <FieldError errors={fieldErrors(field.state.meta.errors)} />
                ) : (
                  <FieldDescription>Together {formatCents(total)}.</FieldDescription>
                )}
              </Field>
            );
          }}
        </form.Field>
      )}

      <form.AppField name="method" validators={{ onChange: ({ value }) => requiredError(value, "Choose how it was paid") }}>
        {(field) => <field.ChoiceField label="Paid by" options={PAYMENT_CHOICES} />}
      </form.AppField>

      <form.AppField name="paidOn" validators={{ onChange: ({ value }) => requiredError(value, "Pick the day it was paid") }}>
        {(field) => (
          <field.TextField
            label="On"
            type="date"
            className="w-auto"
            inputClassName="w-auto"
            // Money comes in on a day that has come; one ahead is most likely a slip.
            description={field.state.value > todayISO() ? "That day hasn't come yet." : undefined}
          />
        )}
      </form.AppField>

      {onCancel ? (
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <form.AppForm>
            <form.SubmitButton label="Mark paid" />
          </form.AppForm>
        </DialogFooter>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <form.AppForm>
            <form.SubmitButton label="Mark paid" />
          </form.AppForm>
        </div>
      )}
    </form>
  );
}
