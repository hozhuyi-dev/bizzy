import type { Conflict } from "./conflicts.types";
import { invoke } from "~/core/lambda/lambda.client";

export const ConflictsService = {
  list: () => invoke<Array<Conflict>>("conflicts.list"),
  /** The edits waiting on one session's event. */
  listByTarget: (targetId: string) => invoke<Array<Conflict>>("conflicts.listByTarget", { targetId }),
  /** Writes the session back over her edit: its event as it is, or back from the trash. */
  revert: (key: string) => invoke<null>("calendar.revert", { key }),
  /** Reads her edit again: applied once nothing refuses it, else refused with why. */
  apply: (key: string) => invoke<null>("conflicts.apply", { key }),
  /** A new event that isn't a session: the sync leaves it alone. */
  ignore: (key: string) => invoke<null>("calendar.ignore", { key }),
};
