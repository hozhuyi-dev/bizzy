import { sessionMinutes } from "./session-stage.util";
import type { PayBy, SessionDraft, SessionFields, SessionView } from "./sessions.types";
import type { PaymentMethod } from "~/features/payments/payments.types";
import { addDays, toISODate, toTimeInput, todayISO } from "~/core/utils/date.util";
import { centsToInput, parseCents } from "~/core/utils/money.util";

/** Whether a package's price is per hour (`10x180`) or the total (`10@1800`). */
export type PriceIs = "each" | "total";

export interface BookingValues {
  clientId: string;
  date: string;
  time: string;
  minutes: string;
  /** A new one's: how it is paid; blank as a new one is (by package when credits cover some of it). */
  payBy: PayBy | "";
  /** Its whole fee, paid by it; blank for the client's hourly fee. */
  fee: string;
  packageHours: string;
  packagePrice: string;
  packagePriceIs: PriceIs;
  homeVisit: boolean;
  tentative: boolean;
  /** What was received moves to the new amounts (a receipt not issued yet). */
  updatePayment: boolean;
  /** Who pays; blank for whom the client is billed to. */
  billTo: string;
  /** A new one's: how it was paid there and then; blank leaves it to collect. */
  paidBy: PaymentMethod | "";
  paidOn: string;
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
    payBy: session.pay.by,
    ...(session.feeTyped ? { feeCents: session.feeCents } : {}),
    ...(session.bought ? { package: { hours: session.bought.hours, priceCents: session.bought.priceCents } } : {}),
    homeVisit: session.location === "visit",
    tentative: session.tentative,
    billTo: session.payer,
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
    payBy: draft.payBy ?? "",
    fee: centsToInput(draft.feeCents),
    ...packageValues(draft.package),
    homeVisit: draft.homeVisit,
    tentative: draft.tentative,
    updatePayment: false,
    billTo: draft.billTo ?? "",
    paidBy: draft.payment?.method ?? "",
    paidOn: draft.payment?.paidOn ?? todayISO(),
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
    ...(values.payBy ? { payBy: values.payBy } : {}),
    // A fee is typed only for one paid by it.
    ...(fee !== null && values.payBy !== "package" ? { feeCents: fee } : {}),
    ...(values.packageHours.trim() && hours >= 1 && price !== null && price > 0
      ? { package: { hours, priceCents: values.packagePriceIs === "each" ? price * hours : price } }
      : {}),
    homeVisit: values.homeVisit,
    tentative: values.tentative,
    ...(values.billTo ? { billTo: values.billTo } : {}),
    ...(values.paidBy && !values.tentative ? { payment: { method: values.paidBy, paidOn: values.paidOn } } : {}),
  };
}

/** When a booking starts and ends. */
export function sessionTime(draft: Pick<SessionDraft, "start" | "minutes">): { start: string; end: string } {
  const start = new Date(draft.start);
  return { start: start.toISOString(), end: new Date(start.getTime() + draft.minutes * 60_000).toISOString() };
}

/**
 * What to send for a booking: all of it for a new session, and only what
 * changed from `was` for an edit, since an update is a patch. How it is
 * paid only once chosen; a fee or package taken away is sent empty, which
 * returns the session to the usual fee, or drops the package.
 */
export function toSessionFields(draft: SessionDraft, was?: SessionDraft): SessionFields {
  const fields: SessionFields = {};
  if (!was || draft.clientId !== was.clientId) fields.clientId = draft.clientId;
  if (!was || !sameInstant(draft.start, was.start) || draft.minutes !== was.minutes) fields.time = sessionTime(draft);
  if (!was || draft.homeVisit !== was.homeVisit) fields.location = draft.homeVisit ? "visit" : "own";
  if (!was || draft.tentative !== was.tentative) fields.tentative = draft.tentative;
  if (draft.payBy && draft.payBy !== was?.payBy) fields.pay = { by: draft.payBy };
  if (was ? draft.feeCents !== was.feeCents : draft.feeCents !== undefined) {
    fields.fee = draft.feeCents === undefined ? {} : { cents: draft.feeCents };
  }
  if (was ? !samePackage(draft.package, was.package) : draft.package !== undefined) {
    fields.package = draft.package ? { bought: draft.package } : {};
  }
  // Only who the user chose: left as it was, it is whom the client is billed to.
  if (draft.billTo && draft.billTo !== was?.billTo) fields.billTo = draft.billTo;
  // Only as it is added: afterwards a payment is recorded as itself (Mark paid).
  if (!was && draft.payment) fields.payment = draft.payment;
  return fields;
}

function sameInstant(a: string, b: string): boolean {
  return new Date(a).getTime() === new Date(b).getTime();
}

function samePackage(a: SessionDraft["package"], b: SessionDraft["package"]): boolean {
  return a?.hours === b?.hours && a?.priceCents === b?.priceCents;
}

/** How a session is paid, as its Payment step changes it. */
export interface PayValues {
  by: PayBy;
  /** The package to pay first; blank for the oldest bought by its start. */
  packageId: string;
  /** Paid by its fee: its whole fee; blank for the client's hourly fee. */
  fee: string;
  /** What was received moves to a new fee (a receipt not issued yet). */
  updatePayment: boolean;
}

export function toPayValues(session: SessionView): PayValues {
  return {
    by: session.pay.by,
    packageId: session.pay.packageId ?? "",
    fee: session.feeTyped ? centsToInput(session.feeCents) : "",
    updatePayment: false,
  };
}

/**
 * What to send to pay a session as the values say: how it is paid,
 * always (the API judges only a change), and, paid by its fee, the fee
 * when it changed, empty once cleared for the usual one.
 */
export function toPayFields(values: PayValues, session: SessionView): SessionFields {
  const fields: SessionFields =
    values.by === "package"
      ? { pay: { by: "package", ...(values.packageId ? { packageId: values.packageId } : {}) } }
      : { pay: { by: "fee" } };
  if (values.by === "fee") {
    const fee = parseCents(values.fee) ?? undefined;
    if (fee !== (session.feeTyped ? session.feeCents : undefined)) fields.fee = fee === undefined ? {} : { cents: fee };
  }
  if (values.updatePayment) fields.updatePayment = true;
  return fields;
}
