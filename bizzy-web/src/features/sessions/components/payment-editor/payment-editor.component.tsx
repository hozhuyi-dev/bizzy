import { useState } from "react";
import { toast } from "sonner";
import { cn } from "cn";
import { dueCents } from "../../session-stage";
import { SessionsMutation } from "../../sessions.mutation";
import { PAYMENT_METHODS, methodLabel } from "../../sessions.types";
import type { PaymentInput, PaymentMethod, Session } from "../../sessions.types";
import type { Package } from "~/features/packages/packages.types";
import { creditsLeft } from "~/features/packages/packages.types";
import { Button } from "~/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { formatDate, todayISO } from "~/core/utils/date.util";
import { centsToInput, formatCents, parseCents } from "~/core/utils/money.util";

interface PaymentEditorProps {
  session: Session;
  /** The package whose credit covers it, if one does. */
  coveringPackage: Package | undefined;
  /** Why she can't record a payment yet; the editor shows this instead. */
  blocked?: string | undefined;
}

/**
 * What the session costs and how it was settled: paid (how, how much, when)
 * or waived. Nothing is due for a session a package credit covers.
 */
export function PaymentEditor({ session, coveringPackage, blocked }: PaymentEditorProps) {
  const [changing, setChanging] = useState(false);
  const due = dueCents(session);
  const { payment } = session;

  if (blocked) return <p className="text-sm text-muted-foreground">{blocked}</p>;

  if (payment && !changing) {
    return <PaymentSummary session={session} onChange={() => setChanging(true)} />;
  }

  if (!payment && due === 0) {
    return (
      <p className="text-sm">
        {coveringPackage ? (
          <>
            Covered by the package bought {formatDate(coveringPackage.purchasedAt)}
            <span className="text-muted-foreground">
              {" "}
              · {creditsLeft(coveringPackage)} of {coveringPackage.sessions} credits left
            </span>
          </>
        ) : (
          "Nothing to pay for this session."
        )}
      </p>
    );
  }

  return <PaymentForm session={session} due={due} onDone={() => setChanging(false)} />;
}

function PaymentSummary({ session, onChange }: { session: Session; onChange: () => void }) {
  const setPayment = SessionsMutation.useSetPayment();
  const { payment } = session;
  if (!payment) return null;
  const locked = Boolean(session.receipt);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm">
        {payment.status === "paid" ? (
          <>
            <b>{formatCents(payment.amountCents)}</b> paid by {methodLabel(payment.method)} on {formatDate(payment.paidOn)}
          </>
        ) : (
          <>Waived on {formatDate(payment.paidOn)}</>
        )}
      </p>
      {locked ? (
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
                { eventId: session.eventId, payment: null },
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

function PaymentForm({ session, due, onDone }: { session: Session; due: number; onDone: () => void }) {
  const setPayment = SessionsMutation.useSetPayment();
  const previous = session.payment;
  const [method, setMethod] = useState<PaymentMethod | undefined>(previous?.method);
  const [amount, setAmount] = useState(centsToInput(previous?.status === "paid" ? previous.amountCents : due));
  const [paidOn, setPaidOn] = useState(previous?.paidOn ?? todayISO());
  const cents = parseCents(amount);

  const submit = (payment: PaymentInput) =>
    setPayment.mutate(
      { eventId: session.eventId, payment },
      {
        onSuccess: () => {
          toast.success(payment.status === "paid" ? "Marked paid" : "Waived");
          onDone();
        },
        onError: (error) => toast.error(error.message),
      },
    );

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (method && cents) submit({ status: "paid", method, amountCents: cents, paidOn });
      }}
    >
      <p className="text-sm">
        <b>{formatCents(due)}</b> due
        {session.boughtCents ? (
          <span className="text-muted-foreground"> · includes the package bought ({formatCents(session.boughtCents)})</span>
        ) : null}
      </p>

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
        <Field data-invalid={cents === null} className="w-32">
          <FieldLabel htmlFor="payment-amount">Amount</FieldLabel>
          <Input id="payment-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field className="w-auto">
          <FieldLabel htmlFor="payment-date">On</FieldLabel>
          <Input id="payment-date" type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
        </Field>
      </div>
      {cents !== null && cents !== due && (
        <FieldDescription className={cn(cents < due && "text-status-attention-foreground")}>
          {cents < due ? `${formatCents(due - cents)} less than due.` : `${formatCents(cents - due)} more than due.`}
        </FieldDescription>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={!method || !cents || setPayment.isPending}>
          Mark paid
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={setPayment.isPending}
          onClick={() => submit({ status: "waived", amountCents: 0, paidOn })}
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
