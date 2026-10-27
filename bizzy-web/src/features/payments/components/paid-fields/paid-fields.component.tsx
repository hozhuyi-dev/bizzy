import { PAID_NOW_CHOICES, PAYMENT_CHOICES } from "../../payments.constant";
import type { ReactNode } from "react";
import { ChoiceField, TextField } from "~/components/shared/form/form-fields.component";
import { useFieldContext } from "~/components/shared/form/form-context.hook";
import { todayISO } from "~/core/utils/date.util";

/*
 * The two questions every payment form asks, worded alike wherever money is
 * recorded: Mark paid on a session or package, a client's Record a payment,
 * and a new session or package paid there and then. Each goes inside the
 * form.AppField for its value.
 */

/** How it was paid; with `notYet`, "Not yet" first (a new item, left to collect). */
export function PaidByField({ notYet = false, description }: { notYet?: boolean; description?: ReactNode }) {
  return <ChoiceField label="Paid by" options={notYet ? PAID_NOW_CHOICES : PAYMENT_CHOICES} description={description} />;
}

/** The day it was paid: money comes in on a day that has come, so one ahead is most likely a slip. */
export function PaidOnField() {
  const field = useFieldContext<string>();
  return (
    <TextField
      label="Paid on"
      type="date"
      inputClassName="max-w-44"
      description={field.state.value > todayISO() ? "That day hasn't come yet." : undefined}
    />
  );
}
