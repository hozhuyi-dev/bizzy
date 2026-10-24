import type { AppStatusView } from "./app.types";
import { invoke } from "~/core/lambda/lambda.client";

export const AppService = {
  status: () => invoke<AppStatusView>("app.status"),
  /** Nothing but what every reply says, each kind's version: so what changed elsewhere is read again (see invoke). */
  versions: () => invoke<null>("app.versions"),
};
