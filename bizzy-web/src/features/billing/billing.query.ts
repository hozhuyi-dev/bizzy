import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { BillingService } from "./billing.service";
import type { PreviewInput } from "./billing.types";
import { BillingKeys } from "~/core/constants/query-keys.constant";

export const BillingQuery = {
  /** What would pay for a booking; keeps the last answer while the form changes. */
  usePreview: (input: PreviewInput | undefined) =>
    useQuery({
      queryKey: BillingKeys.preview(input ?? {}),
      queryFn: () => BillingService.preview(input as PreviewInput),
      enabled: input !== undefined,
      placeholderData: keepPreviousData,
    }),
};
