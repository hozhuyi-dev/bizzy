import { useCallback } from "react";
import { toast } from "sonner";
import { BanknoteIcon } from "lucide-react";
import { PaymentsMutation } from "./payments.mutation";
import { PAYMENT_METHODS } from "./payments.constant";
import type { Payable } from "./payments.types";
import type { Action, MenuItemAction } from "~/components/shared/actions/action-bar/action-bar.types";
import { toastRefusal } from "~/features/remedies/components/remedy-buttons/remedy-buttons.component";
import { formatCents } from "~/core/utils/money.util";
import { todayISO } from "~/core/utils/date.util";

/** The last of Paid ▾: paid on another day, at the item's home (its payment section or step). */
export const ANOTHER_DAY = "Another day…";

/**
 * Makes Paid ▾ for what is owed on an item, the one way to pay wherever it
 * is listed (a table row, a card, the to-do list, a timeline): paid today
 * in one tap by method, everything owed at once, with an Undo in the
 * toast; or `another` (ANOTHER_DAY), opening the item at its payment.
 */
export function usePaidAction(): (payables: ReadonlyArray<Payable>, another: MenuItemAction) => Action {
  // Stable while nothing is paying, so a table's columns aren't made anew each render.
  const { mutate, isPending } = PaymentsMutation.useSet();
  return useCallback((payables, another) => {
    const total = payables.reduce((sum, p) => sum + p.dueCents, 0);
    const items = payables.map((p) => p.item);
    const payWith = (method: (typeof PAYMENT_METHODS)[number]) =>
      mutate(
        { items, payment: { method: method.value, paidOn: todayISO() } },
        {
          onSuccess: () =>
            toast.success(`${formatCents(total)} paid by ${method.label}`, {
              action: {
                label: "Undo",
                onClick: () =>
                  mutate({ items, payment: null }, { onSuccess: () => toast.success("Payment undone"), onError: toastRefusal }),
              },
            }),
          onError: toastRefusal,
        },
      );
    return {
      type: "menu",
      label: "Paid",
      icon: BanknoteIcon,
      disabled: isPending,
      heading: `${payables.map((p) => p.label).join(" and ")} · ${formatCents(total)} today, by`,
      actions: [
        ...PAYMENT_METHODS.map((method): MenuItemAction => ({ type: "button", label: method.label, onClick: () => payWith(method) })),
        another,
      ],
    };
  }, [mutate, isPending]);
}
