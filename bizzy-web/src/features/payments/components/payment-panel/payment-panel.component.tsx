import { useState } from "react";
import { toast } from "sonner";
import { cn } from "cn";
import { PaymentsMutation } from "../../payments.mutation";
import { PAYMENT_METHODS } from "../../payments.constant";
import { methodLabel } from "../../payments.util";
import type { Payable, Payment, PaymentInput, PaymentMethod } from "../../payments.types";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Field, FieldDescription, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { formatDate, todayISO } from "~/core/utils/date.util";
import { centsToInput, formatCents, parseCents } from "~/core/utils/money.util";

/**
 * How each item was settled, and a form for those still due. Items due
 * together are paid in one go (each at its own price) or one at a time:
 * clients pay in full, but not always for everything at once.
 */
export function PaymentPanel({
  payables,
  onPaid,
}: {
  payables: ReadonlyArray<Payable>;
  /** After paying or waiving what was due. */
  onPaid?: () => void;
}) {
  const [changing, setChanging] = useState<string>();
  const key = (p: Payable) => `${p.item.kind}:${p.item.id}`;
  const settled = payables.filter((p) => p.payment && key(p) !== changing);
  const due = payables.filter((p) => !p.payment && p.dueCents > 0);
  const editing = payables.find((p) => key(p) === changing);
  const single = payables.length === 1;

  return (
    <div className="flex flex-col gap-4">
      {settled.map((p) => (
        <PaymentSummary key={key(p)} payable={p} showLabel={!single} onChange={() => setChanging(key(p))} />
      ))}
      {editing ? (
        <PaymentForm key={key(editing)} payables={[editing]} previous={editing.payment} onDone={() => setChanging(undefined)} />
      ) : (
        due.length > 0 && <PaymentForm key={due.map(key).join()} payables={due} onDone={onPaid} />
      )}
    </div>
  );
}

function PaymentSummary({ payable, showLabel, onChange }: { payable: Payable; showLabel: boolean; onChange: () => void }) {
  const setPayment = PaymentsMutation.useSet();
  const { payment } = payable;
  if (!payment) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm">
        {showLabel && <span className="text-muted-foreground">{payable.label}: </span>}
        {payment.status === "paid" ? (
          <>
            <b>{formatCents(payment.amountCents)}</b> paid by {methodLabel(payment.method)} on {formatDate(payment.paidOn)}
          </>
        ) : (
          <>Waived on {formatDate(payment.paidOn)}</>
        )}
      </p>
      {payable.receipted ? (
        <span className="text-xs text-muted-foreground">A receipt covers it.</span>
      ) : (
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onChange}>
            Change
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={setPayment.isPending}
            onClick={() =>
              setPayment.mutate(
                { items: [payable.item], payment: null },
                {
                  onSuccess: () => toast.success("Payment undone"),
                  onError: (error) => toast.error(error.message),
                },
              )
            }
          >
            Undo
          </Button>
        </div>
      )}
    </div>
  );
}

interface PaymentFormProps {
  payables: ReadonlyArray<Payable>;
  /** The payment being changed, to start from. */
  previous?: Payment | undefined;
  onDone?: (() => void) | undefined;
}

function PaymentForm({ payables, previous, onDone }: PaymentFormProps) {
  const setPayment = PaymentsMutation.useSet();
  const [chosen, setChosen] = useState(() => new Set(payables.map((p) => p.item.id + p.item.kind)));
  const [method, setMethod] = useState<PaymentMethod | undefined>(previous?.method);
  const [paidOn, setPaidOn] = useState(previous?.paidOn ?? todayISO());
  const selected = payables.filter((p) => chosen.has(p.item.id + p.item.kind));
  const due = selected.reduce((sum, p) => sum + p.dueCents, 0);
  // One item takes any amount; several are each paid at their own price.
  const [only] = payables;
  const single = payables.length === 1 && only !== undefined;
  const [amount, setAmount] = useState(centsToInput(previous?.status === "paid" ? previous.amountCents : due));
  const cents = single ? parseCents(amount) : due;

  const submit = (payment: PaymentInput) =>
    setPayment.mutate(
      { items: selected.map((p) => (single && cents ? { ...p.item, amountCents: cents } : p.item)), payment },
      {
        onSuccess: () => {
          toast.success(payment.status === "paid" ? "Marked paid" : "Waived");
          onDone?.();
        },
        onError: (error) => toast.error(error.message),
      },
    );

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (method && cents) submit({ status: "paid", method, paidOn });
      }}
    >
      {single ? (
        <p className="text-sm">
          <b>{formatCents(only.dueCents)}</b> due for the {only.label.toLowerCase()}
        </p>
      ) : (
        <Field>
          <FieldLabel id="payment-items">Paying for</FieldLabel>
          <ul aria-labelledby="payment-items" className="flex flex-col gap-2 text-sm">
            {payables.map((p) => {
              const id = `pay-${p.item.kind}-${p.item.id}`;
              const k = p.item.id + p.item.kind;
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
          <FieldDescription>
            {selected.length === 0 ? "Choose what was paid." : <>Together {formatCents(due)}. For another amount, pay one at a time.</>}
          </FieldDescription>
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

      <div className="flex flex-wrap gap-4">
        {single && (
          <Field data-invalid={cents === null} className="w-32">
            <FieldLabel htmlFor="payment-amount">Amount</FieldLabel>
            <Input id="payment-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
        )}
        <Field className="w-auto">
          <FieldLabel htmlFor="payment-date">On</FieldLabel>
          <Input id="payment-date" type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
        </Field>
      </div>
      {single && cents !== null && cents !== only.dueCents && (
        <FieldDescription className={cn(cents < only.dueCents && "text-status-attention-foreground")}>
          {cents < only.dueCents
            ? `${formatCents(only.dueCents - cents)} less than due.`
            : `${formatCents(cents - only.dueCents)} more than due.`}
        </FieldDescription>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={!method || !cents || selected.length === 0 || setPayment.isPending}>
          Mark paid
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={selected.length === 0 || setPayment.isPending}
          onClick={() => submit({ status: "waived", paidOn })}
        >
          Waive
        </Button>
        {previous && (
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
