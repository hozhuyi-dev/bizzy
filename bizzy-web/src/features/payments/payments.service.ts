import type { SetPaymentRequest } from "./payments.types";
import { invoke } from "~/core/lambda/lambda.client";

export const PaymentsService = {
  /**
   * Pays the items in full, together (all or none); a null payment undoes
   * theirs. A session pays everything it owes: its fee and the package
   * bought in it.
   */
  set: (request: SetPaymentRequest) => invoke<null>("payments.set", request),
};
