import type { CreateFollowUpRequest, FollowUpFields, FollowUpTarget, FollowUpView, FollowUpWhen } from "./follow-ups.types";
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
    clientId: followUp.clientId,
    date: toISODate(due),
    allDay: followUp.allDay,
    time: toTimeInput(due),
    summary: followUp.summary,
    notes: followUp.notes,
  };
}

/** When it is due: the day for an all-day one, else the time, read as the user's local time. */
function whenOf(values: FollowUpValues): FollowUpWhen {
  return values.allDay ? { date: values.date } : { start: new Date(`${values.date}T${values.time}`).toISOString() };
}

/** A new follow-up, from a session (`sessionId`) or not. */
export function toCreateFollowUp(values: FollowUpValues, sessionId: string | undefined): CreateFollowUpRequest {
  return {
    clientId: values.clientId,
    when: whenOf(values),
    summary: values.summary,
    notes: values.notes,
    ...(sessionId ? { sessionId } : {}),
  };
}

/** What changed on a follow-up: an update is a patch. */
export function toFollowUpFields(values: FollowUpValues, was: FollowUpView): FollowUpFields {
  const before = toFollowUpValues({ mode: "edit", followUp: was });
  const fields: FollowUpFields = {};
  if (values.clientId !== before.clientId) fields.clientId = values.clientId;
  if (values.allDay !== before.allDay || values.date !== before.date || (!values.allDay && values.time !== before.time)) {
    fields.when = whenOf(values);
  }
  if (values.summary !== before.summary) fields.summary = values.summary;
  if (values.notes !== before.notes) fields.notes = values.notes;
  return fields;
}
