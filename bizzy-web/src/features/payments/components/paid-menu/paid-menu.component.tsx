import { toast } from "sonner";
import { BanknoteIcon, ChevronDownIcon } from "lucide-react";
import { PaymentsMutation } from "../../payments.mutation";
import { PAYMENT_METHODS } from "../../payments.constant";
import type { Payable } from "../../payments.types";
import { toastRefusal } from "~/features/remedies/components/remedy-buttons/remedy-buttons.component";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { formatCents } from "~/core/utils/money.util";
import { todayISO } from "~/core/utils/date.util";

/**
 * Mark paid today in one tap by method: everything owed at once, with an
 * Undo in the toast. Another day opens the payment form (`onOther`).
 */
export function PaidMenu({ payables, onOther }: { payables: ReadonlyArray<Payable>; onOther: () => void }) {
  const pay = PaymentsMutation.useSet();
  const total = payables.reduce((sum, p) => sum + p.dueCents, 0);
  const label = payables.map((p) => p.label).join(" and ");
  const items = payables.map((p) => p.item);

  const payWith = (method: (typeof PAYMENT_METHODS)[number]) =>
    pay.mutate(
      { items, payment: { method: method.value, paidOn: todayISO() } },
      {
        onSuccess: () =>
          toast.success(`${formatCents(total)} paid by ${method.label}`, {
            action: {
              label: "Undo",
              onClick: () =>
                pay.mutate({ items, payment: null }, { onSuccess: () => toast.success("Payment undone"), onError: toastRefusal }),
            },
          }),
        onError: toastRefusal,
      },
    );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button size="sm" variant="outline" disabled={pay.isPending} />}>
        <BanknoteIcon /> Paid <ChevronDownIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto">
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            {label} · {formatCents(total)} today, by
          </DropdownMenuLabel>
          {PAYMENT_METHODS.map((method) => (
            <DropdownMenuItem key={method.value} onClick={() => payWith(method)}>
              {method.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onOther}>Another day…</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
