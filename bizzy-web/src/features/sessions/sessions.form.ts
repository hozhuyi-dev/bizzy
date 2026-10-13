import type { SessionDraft } from "./sessions.types";
import { toISODate, toTimeInput } from "~/core/utils/date.util";
import { centsToInput, parseCents } from "~/core/utils/money.util";

/** Whether a package's price is per session (`10x180`) or the total (`10@1800`). */
export type PriceIs = "each" | "total";

export interface BookingValues {
  clientId: string;
  date: string;
  time: string;
  minutes: string;
  /** Blank leaves it to a package credit or the default fee. */
  fee: string;
  packageSessions: string;
  packagePrice: string;
  packagePriceIs: PriceIs;
  homeVisit: boolean;
  tentative: boolean;
}

/** Now, on the hour: most often she's adding the session she just had. */
export function newSessionDraft(now = new Date()): SessionDraft {
  const start = new Date(now);
  start.setMinutes(0, 0, 0);
  return { clientId: "", start: start.toISOString(), minutes: 60, homeVisit: false, tentative: false };
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
  };
}

/** Per session when the total divides evenly, as the title writes it. */
function packageValues(
  pkg: SessionDraft["package"],
): Pick<BookingValues, "packageSessions" | "packagePrice" | "packagePriceIs"> {
  if (!pkg) return { packageSessions: "", packagePrice: "", packagePriceIs: "each" };
  const each = pkg.priceCents % pkg.sessions === 0;
  return {
    packageSessions: String(pkg.sessions),
    packagePrice: centsToInput(each ? pkg.priceCents / pkg.sessions : pkg.priceCents),
    packagePriceIs: each ? "each" : "total",
  };
}

export function toSessionDraft(values: BookingValues): SessionDraft {
  const fee = parseCents(values.fee);
  const sessions = Number(values.packageSessions);
  const price = parseCents(values.packagePrice);
  return {
    clientId: values.clientId,
    // Read as her local time.
    start: new Date(`${values.date}T${values.time}`).toISOString(),
    minutes: Number(values.minutes),
    ...(fee !== null ? { feeCents: fee } : {}),
    ...(values.packageSessions.trim() && sessions >= 1 && price !== null && price > 0
      ? { package: { sessions, priceCents: values.packagePriceIs === "each" ? price * sessions : price } }
      : {}),
    homeVisit: values.homeVisit,
    tentative: values.tentative,
  };
}
