import type { ConflictView } from "./conflicts.types";
import { invoke } from "~/core/lambda/lambda.client";

export const ConflictsService = {
  list: () => invoke<Array<ConflictView>>("conflicts.list"),
  /** The edits waiting on one session or follow-up. */
  listByTarget: (itemId: string) => invoke<Array<ConflictView>>("conflicts.listByTarget", { itemId }),
  /** Puts bizzy's version back over the edit; deletes an event that shows nothing of bizzy's. */
  revert: (eventId: string) => invoke<null>("calendar.revert", { id: eventId }),
  /** Reads the edit again: applied once nothing refuses it, else refused with why. */
  apply: (eventId: string) => invoke<null>("conflicts.apply", { id: eventId }),
};
