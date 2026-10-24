import { usePaidAction } from "../../paid-action.hook";
import type { Payable } from "../../payments.types";
import type { MenuItemAction } from "~/components/shared/actions/action-bar/action-bar.types";
import { ActionButton } from "~/components/shared/actions/action-bar/action-bar.component";

/**
 * Paid ▾ as a button of its own, for a row that lays out its own buttons
 * (the to-do list, a timeline): the same as a table's (usePaidAction).
 */
export function PaidMenu({ payables, another }: { payables: ReadonlyArray<Payable>; another: MenuItemAction }) {
  const paid = usePaidAction();
  return <ActionButton action={paid(payables, another)} size="sm" />;
}
