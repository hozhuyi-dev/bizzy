import { useState } from "react";
import { toast } from "sonner";
import { PaymentsMutation } from "../../payments.mutation";
import { PAYMENT_METHODS } from "../../payments.constant";
import { methodLabel } from "../../payments.util";
import type { Payable, PaymentMethod } from "../../payments.types";
import { toastRefusal } from "~/features/remedies/components/remedy-buttons/remedy-buttons.component";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Field, FieldDescription, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { formatDate, todayISO } from "~/core/utils/date.util";
import { formatCents } from "~/core/utils/money.util";

const keyOf = (p: Payable) => `${p.item.kind}:${p.item.id}:${p.paid ? "paid" : "owed"}`;

/**
 * What was received for each item, and a form for what is still owed.
 * Clients pay in full: each item is paid all it owes. A payment is a draft
 * receipt until it is issued; after that, it stays as issued. One recorded
 * by mistake is undone, and recorded again.
 */
export function PaymentPanel({
  payables,
  onPaid,
}: {
  payables: ReadonlyArray<Payable>;
  /** After recording what was owed. */
  onPaid?: () => void;
}) {
  const paid = payables.filter((p) => p.paid);
  const owed = payables.filter((p) => !p.paid && p.dueCents > 0);

  return (
    <div className="flex flex-col gap-4">
      {paid.map((p) => (
        <PaymentSummary key={keyOf(p)} payable={p} showLabel={payables.length > 1} />
      ))}
      {owed.length > 0 && <PaymentForm key={owed.map(keyOf).join()} payables={owed} onDone={onPaid} />}
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
}

function PaymentForm({ payables, onDone }: PaymentFormProps) {
  const setPayment = PaymentsMutation.useSet();
  const [chosen, setChosen] = useState(() => new Set(payables.map(keyOf)));
  const [method, setMethod] = useState<PaymentMethod>();
  const [paidOn, setPaidOn] = useState(todayISO());
  const selected = payables.filter((p) => chosen.has(keyOf(p)));
  const total = selected.reduce((sum, p) => sum + p.dueCents, 0);
  const [first] = payables;
  const single = payables.length === 1;

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!method) return;
        setPayment.mutate(
          { items: selected.map((p) => p.item), payment: { method, paidOn } },
          {
            onSuccess: () => {
              toast.success(`${formatCents(total)} paid by ${methodLabel(method)}`);
              onDone?.();
            },
            onError: toastRefusal,
          },
        );
      }}
    >
      {single && first ? (
        <p className="text-sm">
          <b>{formatCents(first.dueCents)}</b> for the {first.label.toLowerCase()}
        </p>
      ) : (
        <Field>
          <FieldLabel id="payment-items">Paying for</FieldLabel>
          <ul aria-labelledby="payment-items" className="flex flex-col gap-2 text-sm">
            {payables.map((p) => {
              const k = keyOf(p);
              const id = `pay-${k.replaceAll(":", "-")}`;
              return (
                <li key={k} className="flex items-center gap-2">
                  <Checkbox
                    id={id}
                    checked={chosen.has(k)}
                    onCheckedChange={(checked) =>
                      setChosen((current) => {
                        const next = new Set(current);
                        if (checked) next.add(k);
                        else next.delete(k);
                        return next;
                      })
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
          <FieldDescription>{selected.length === 0 ? "Choose what was paid." : <>Together {formatCents(total)}.</>}</FieldDescription>
        </Field>
      )}

      <Field>
        <FieldLabel id="payment-method">Paid by</FieldLabel>
        <div role="radiogroup" aria-labelledby="payment-method" className="flex flex-wrap gap-2">
          {PAYMENT_METHODS.map((option) => (
            <Button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={method === option.value}
              variant={method === option.value ? "default" : "outline"}
              size="sm"
              title={option.label}
              onClick={() => setMethod(option.value)}
            >
              {option.short}
            </Button>
          ))}
        </div>
      </Field>

      <Field className="w-auto">
        <FieldLabel htmlFor="payment-date">On</FieldLabel>
        <Input id="payment-date" type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} className="w-auto" />
      </Field>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={!method || selected.length === 0 || setPayment.isPending}>
          Mark paid
        </Button>
      </div>
    </form>
  );
}
