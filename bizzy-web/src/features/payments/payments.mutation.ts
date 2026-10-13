import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PaymentsService } from "./payments.service";
import type { PayItem, PaymentInput } from "./payments.types";
import { invalidateBilling } from "~/core/utils/query.util";

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
