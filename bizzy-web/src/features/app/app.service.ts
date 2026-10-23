import type { AppStatusView } from "./app.types";
import { invoke } from "~/core/lambda/lambda.client";

export const AppService = {
  status: () => invoke<AppStatusView>("app.status"),
};
