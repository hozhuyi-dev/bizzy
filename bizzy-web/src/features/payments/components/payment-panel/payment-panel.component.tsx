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

/**
 * What was received for each item, and a form for those still owed. Clients
 * pay in full: each item is paid what its invoice charges, together or one
 * at a time. A payment is a draft receipt until she issues it; after that,
 * it stays as issued.
 */
export function PaymentPanel({
  payables,
  onPaid,
}: {
  payables: ReadonlyArray<Payable>;
  /** After recording what was owed. */
  onPaid?: () => void;
}) {
  const [changing, setChanging] = useState<string>();
  const key = (p: Payable) => `${p.item.kind}:${p.item.id}`;
  const paid = payables.filter((p) => p.paid && key(p) !== changing);
  const owed = payables.filter((p) => !p.paid && p.dueCents > 0);
  const editing = payables.find((p) => key(p) === changing);
  const single = payables.length === 1;

  return (
    <div className="flex flex-col gap-4">
      {paid.map((p) => (
        <PaymentSummary key={key(p)} payable={p} showLabel={!single} onChange={() => setChanging(key(p))} />
      ))}
      {editing ? (
        <PaymentForm key={key(editing)} payables={[editing]} editing onDone={() => setChanging(undefined)} />
      ) : (
        owed.length > 0 && <PaymentForm key={owed.map(key).join()} payables={owed} onDone={onPaid} />
      )}
    </div>
  );
}

function PaymentSummary({ payable, showLabel, onChange }: { payable: Payable; showLabel: boolean; onChange: () => void }) {
  const setPayment = PaymentsMutation.useSet();
  const { paid, receipt } = payable;
  if (!paid) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm">
        {showLabel && <span className="text-muted-foreground">{payable.label}: </span>}
        <b>{formatCents(paid.amountCents)}</b> paid by {methodLabel(paid.method)} on {formatDate(paid.paidOn)}
      </p>
      {receipt?.number ? (
        <span className="text-xs text-muted-foreground">On an issued receipt.</span>
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
                { onSuccess: () => toast.success("Payment undone"), onError: toastRefusal },
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
  /** Changing how or when one was paid, rather than recording it. */
  editing?: boolean;
  onDone?: (() => void) | undefined;
}

function PaymentForm({ payables, editing = false, onDone }: PaymentFormProps) {
  const setPayment = PaymentsMutation.useSet();
  const [chosen, setChosen] = useState(() => new Set(payables.map((p) => p.item.id + p.item.kind)));
  const [first] = payables;
  const [method, setMethod] = useState<PaymentMethod | undefined>(editing ? first?.paid?.method : undefined);
  const [paidOn, setPaidOn] = useState(editing && first?.paid ? first.paid.paidOn : todayISO());
  const selected = payables.filter((p) => chosen.has(p.item.id + p.item.kind));
  const total = selected.reduce((sum, p) => sum + p.dueCents, 0);
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
          {editing ? "Save payment" : "Mark paid"}
        </Button>
        {editing && (
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
