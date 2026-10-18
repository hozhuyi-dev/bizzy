import type { ConflictView } from "./conflicts.types";
import { formatSessionTime } from "~/core/utils/date.util";

/** When the refused event is, if it is timed: an all-day one has the zero time. */
export function conflictTime(conflict: ConflictView): string | undefined {
  return new Date(conflict.start).getUTCFullYear() > 1 ? formatSessionTime(conflict.start) : undefined;
}

/** What the user did to the event, in words. */
export function conflictKind(conflict: ConflictView): string {
  if (conflict.gone) return "Deleted in your calendar";
  return conflict.itemId ? "Changed in your calendar" : "New in your calendar";
}
