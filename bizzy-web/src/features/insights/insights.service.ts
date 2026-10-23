import type { InsightsView } from "./insights.types";
import { invoke } from "~/core/lambda/lambda.client";

export const InsightsService = {
  /** A calendar year at a glance, up to this one. */
  year: (year: number) => invoke<InsightsView>("insights.year", { year }),
};
