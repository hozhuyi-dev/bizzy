import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PayItem, PaymentInput } from "./payments.types";
import { invoke } from "~/core/lambda/lambda.client";
import { invalidateBilling } from "~/core/utils/query.util";

export const PaymentsService = {
  /** Pays the items together (all or none); a null payment undoes theirs. */
  set: (items: Array<PayItem>, payment: PaymentInput | null) => invoke<null>("payments.set", { items, payment }),
};

export const PaymentsMutation = {
  /**
   * A payment changes the session or package, what the to-do list shows and
   * the client's income: everything billing is refreshed.
   */
  useSet: () => {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: ({ items, payment }: { items: Array<PayItem>; payment: PaymentInput | null }) =>
        PaymentsService.set(items, payment),
      onSettled: () => invalidateBilling(queryClient),
    });
  },
};
