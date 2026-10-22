import { useMutation } from "@tanstack/react-query";
import { PaymentsService } from "./payments.service";
import type { SetPaymentRequest } from "./payments.types";

export const PaymentsMutation = {
  /** A payment changes the session or package, the to-do list and the client's income: read again as the API says. */
  useSet: () => useMutation({ mutationFn: (request: SetPaymentRequest) => PaymentsService.set(request) }),
};
