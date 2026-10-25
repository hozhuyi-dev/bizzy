import { sessionMinutes } from "./session-stage.util";
import type { SessionDraft, SessionFields, SessionView } from "./sessions.types";
import { addDays, toISODate, toTimeInput } from "~/core/utils/date.util";
import { centsToInput, parseCents } from "~/core/utils/money.util";

/** Whether a package's price is per hour (`10x180`) or the total (`10@1800`). */
export type PriceIs = "each" | "total";

export interface BookingValues {
  clientId: string;
  date: string;
  time: string;
  minutes: string;
  /** Its whole fee; blank leaves it to package credits and the client's hourly fee. */
  fee: string;
  packageHours: string;
  packagePrice: string;
  packagePriceIs: PriceIs;
  homeVisit: boolean;
  tentative: boolean;
  /** What was received moves to the new amounts (a receipt not issued yet). */
  updatePayment: boolean;
}

/** Now, on the hour: most often it's the session that just happened. */
export function newSessionDraft(now = new Date()): SessionDraft {
  const start = new Date(now);
  start.setMinutes(0, 0, 0);
  return { clientId: "", start: start.toISOString(), minutes: 60, homeVisit: false, tentative: false };
}

/** The booking a session's form starts from, as it is now. */
export function draftOf(session: SessionView): SessionDraft {
  return {
    clientId: session.clientId,
    start: session.start,
    minutes: sessionMinutes(session),
    ...(session.feeTyped ? { feeCents: session.feeCents } : {}),
    ...(session.bought ? { package: { hours: session.bought.hours, priceCents: session.bought.priceCents } } : {}),
    homeVisit: session.location === "visit",
    tentative: session.tentative,
  };
}

/**
 * The client's next visit after a session: the same weekday and time a
 * week on, the same length and place, priced as usual (a package credit
 * or the client's fee), confirmed.
 */
export function nextVisitDraft(session: SessionView): SessionDraft {
  const { clientId, start, minutes, homeVisit } = draftOf(session);
  return { clientId, start: addDays(new Date(start), 7).toISOString(), minutes, homeVisit, tentative: false };
}

export function toBookingValues(draft: SessionDraft): BookingValues {
  const start = new Date(draft.start);
  return {
    clientId: draft.clientId,
    date: toISODate(start),
    time: toTimeInput(start),
    minutes: String(draft.minutes),
    fee: centsToInput(draft.feeCents),
    ...packageValues(draft.package),
    homeVisit: draft.homeVisit,
    tentative: draft.tentative,
    updatePayment: false,
  };
}

/** Per hour when the total divides evenly, as the title writes it. */
function packageValues(pkg: SessionDraft["package"]): Pick<BookingValues, "packageHours" | "packagePrice" | "packagePriceIs"> {
  if (!pkg) return { packageHours: "", packagePrice: "", packagePriceIs: "each" };
  const each = pkg.priceCents % pkg.hours === 0;
  return {
    packageHours: String(pkg.hours),
    packagePrice: centsToInput(each ? pkg.priceCents / pkg.hours : pkg.priceCents),
    packagePriceIs: each ? "each" : "total",
  };
}

export function toSessionDraft(values: BookingValues): SessionDraft {
  const fee = parseCents(values.fee);
  const hours = Number(values.packageHours);
  const price = parseCents(values.packagePrice);
  return {
    clientId: values.clientId,
    // Read as the user's local time.
    start: new Date(`${values.date}T${values.time}`).toISOString(),
    minutes: Number(values.minutes),
    ...(fee !== null ? { feeCents: fee } : {}),
    ...(values.packageHours.trim() && hours >= 1 && price !== null && price > 0
      ? { package: { hours, priceCents: values.packagePriceIs === "each" ? price * hours : price } }
      : {}),
    homeVisit: values.homeVisit,
    tentative: values.tentative,
  };
}

/** When a booking starts and ends. */
export function sessionTime(draft: Pick<SessionDraft, "start" | "minutes">): { start: string; end: string } {
  const start = new Date(draft.start);
  return { start: start.toISOString(), end: new Date(start.getTime() + draft.minutes * 60_000).toISOString() };
}

/**
 * What to send for a booking: all of it for a new session, and only what
 * changed from `was` for an edit, since an update is a patch. A fee or
 * package taken away is sent empty, which returns the session to package
 * credits and the usual fee, or drops the package.
 */
export function toSessionFields(draft: SessionDraft, was?: SessionDraft): SessionFields {
  const fields: SessionFields = {};
  if (!was || draft.clientId !== was.clientId) fields.clientId = draft.clientId;
  if (!was || !sameInstant(draft.start, was.start) || draft.minutes !== was.minutes) fields.time = sessionTime(draft);
  if (!was || draft.homeVisit !== was.homeVisit) fields.location = draft.homeVisit ? "visit" : "own";
  if (!was || draft.tentative !== was.tentative) fields.tentative = draft.tentative;
  if (was ? draft.feeCents !== was.feeCents : draft.feeCents !== undefined) {
    fields.fee = draft.feeCents === undefined ? {} : { cents: draft.feeCents };
  }
  if (was ? !samePackage(draft.package, was.package) : draft.package !== undefined) {
    fields.package = draft.package ? { bought: draft.package } : {};
  }
  return fields;
}

function sameInstant(a: string, b: string): boolean {
  return new Date(a).getTime() === new Date(b).getTime();
}

function samePackage(a: SessionDraft["package"], b: SessionDraft["package"]): boolean {
  return a?.hours === b?.hours && a?.priceCents === b?.priceCents;
}
