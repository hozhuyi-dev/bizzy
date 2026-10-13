import type { Cover, FeeImpact, FeeImpactInput, PreviewInput } from "./billing.types";
import { invoke } from "~/core/lambda/lambda.client";

export const BillingService = {
  /** Prices a booking exactly as the reconcile will once it is saved. */
  preview: (input: PreviewInput) => invoke<Cover>("billing.preview", input),
  /** What saving a client's fees would reprice. */
  feeImpact: (input: FeeImpactInput) => invoke<FeeImpact>("billing.feeImpact", input),
};
