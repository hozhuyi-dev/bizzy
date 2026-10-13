import type { PayItem, PaymentInput } from "./payments.types";
import { invoke } from "~/core/lambda/lambda.client";

export const PaymentsService = {
  /** Pays the items together (all or none); a null payment undoes theirs. */
  set: (items: Array<PayItem>, payment: PaymentInput | null) => invoke<null>("payments.set", { items, payment }),
};
