import type { FollowUpView } from "./follow-ups.types";
import { formatDate, formatSessionTime } from "~/core/utils/date.util";

/** "Tue, 14 Oct · 10:00 am", or the day alone for an all-day one. */
export function formatDue(followUp: FollowUpView): string {
  return followUp.allDay ? formatDate(followUp.due) : formatSessionTime(followUp.due);
}
