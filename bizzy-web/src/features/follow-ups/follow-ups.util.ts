import type { FollowUp } from "./follow-ups.types";
import { formatDate, formatSessionTime } from "~/core/utils/date.util";

/** "Tue, 14 Oct · 10:00 am", or the day alone for an all-day one. */
export function formatDue(followUp: FollowUp): string {
  return followUp.allDay ? formatDate(followUp.due) : formatSessionTime(followUp.due);
}
