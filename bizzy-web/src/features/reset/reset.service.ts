import type { ResetResult } from "./reset.types";
import { invoke } from "~/core/lambda/lambda.client";

export const ResetService = {
  reset: () => invoke<ResetResult>("data.reset"),
};
