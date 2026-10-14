import type { Cover, PreviewInput } from "./billing.types";
import { invoke } from "~/core/lambda/lambda.client";

export const BillingService = {
  /** What would pay for a booking, exactly as saving it would choose. */
  preview: (input: PreviewInput) => invoke<Cover>("billing.preview", input),
};
