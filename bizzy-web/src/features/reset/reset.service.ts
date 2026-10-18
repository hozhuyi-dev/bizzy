import type { ResetView } from "./reset.types";
import { invoke } from "~/core/lambda/lambda.client";

export const ResetService = {
  reset: () => invoke<ResetView>("data.reset"),
};
