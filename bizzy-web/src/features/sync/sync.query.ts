import type { AppStatusView } from "~/features/app/app.types";
import { AppQuery } from "~/features/app/app.query";

const sync = (status: AppStatusView) => status.sync;

export const SyncQuery = {
  /** The last run; null before the first. */
  useStatus: () => AppQuery.useStatus(sync),
};
