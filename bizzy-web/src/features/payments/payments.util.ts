import { PAYMENT_METHODS } from "./payments.constant";
import type { PaymentMethod } from "./payments.types";

/** "Touch 'n Go eWallet", as a receipt prints it. */
export function methodLabel(method: PaymentMethod | undefined): string {
  return PAYMENT_METHODS.find((m) => m.value === method)?.label ?? "";
}

/** "TnG", where space is short. */
export function methodShortLabel(method: PaymentMethod | undefined): string {
  return PAYMENT_METHODS.find((m) => m.value === method)?.short ?? "";
}
