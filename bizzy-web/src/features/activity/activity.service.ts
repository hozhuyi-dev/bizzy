import type { ActivityView } from "./activity.types";
import { invoke } from "~/core/lambda/lambda.client";

export const ActivityService = {
  /** Every client's activity as of now; a client with none isn't listed. */
  list: () => invoke<Array<ActivityView>>("activity.list"),
};
