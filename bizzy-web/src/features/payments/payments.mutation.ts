import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PaymentsService } from "./payments.service";
import type { SetPaymentRequest } from "./payments.types";
import { invalidateBilling } from "~/core/utils/query.util";

export const PaymentsMutation = {
  /**
   * A payment changes the session or package, what the to-do list shows and
   * the client's income: everything billing is refreshed.
   */
  useSet: () => {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: (request: SetPaymentRequest) => PaymentsService.set(request),
      onSettled: () => invalidateBilling(queryClient),
    });
  },
};
