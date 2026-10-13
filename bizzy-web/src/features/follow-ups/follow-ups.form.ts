import type { FollowUpDraft, FollowUpTarget } from "./follow-ups.types";
import { addDays, toISODate, toTimeInput } from "~/core/utils/date.util";

export interface FollowUpValues {
  clientId: string;
  date: string;
  allDay: boolean;
  time: string;
  summary: string;
  notes: string;
}

/** YYYY-MM-DD, n days from today, for the quick picks. */
export function daysFromToday(days: number): string {
  return toISODate(addDays(new Date(), days));
}

/** A new one starts all-day a week out; an existing one as it is. */
export function toFollowUpValues(target: FollowUpTarget): FollowUpValues {
  if (target.mode === "new") {
    return { clientId: target.clientId ?? "", date: daysFromToday(7), allDay: true, time: "10:00", summary: "", notes: "" };
  }
  const { followUp } = target;
  const due = new Date(followUp.due);
  return {
    clientId: followUp.clientId ?? followUp.suggestedClientId ?? "",
    date: toISODate(due),
    allDay: Boolean(followUp.allDay),
    time: toTimeInput(due),
    summary: followUp.summary ?? "",
    notes: followUp.notes ?? "",
  };
}

export function toFollowUpDraft(values: FollowUpValues, sessionId: string | undefined): FollowUpDraft {
  return {
    clientId: values.clientId,
    ...(sessionId ? { sessionId } : {}),
    // Read as her local time.
    ...(values.allDay ? { date: values.date } : { start: new Date(`${values.date}T${values.time}`).toISOString() }),
    summary: values.summary,
    notes: values.notes,
  };
}
