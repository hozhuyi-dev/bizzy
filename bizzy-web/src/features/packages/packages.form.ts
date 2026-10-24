import type { PackageFields, PackageView } from "./packages.types";
import type { PaymentMethod } from "~/features/payments/payments.types";
import { centsToInput, parseCents } from "~/core/utils/money.util";
import { toISODate, todayISO } from "~/core/utils/date.util";

export interface PackageFormValues {
  clientId: string;
  hours: string;
  /** Total price, as written after the @. */
  price: string;
  purchasedOn: string;
  note: string;
  /** How it was paid; blank while it isn't, leaving it to collect. */
  paidBy: PaymentMethod | "";
  /** The day it was paid, once it is. */
  paidOn: string;
}

/** A package to edit, as it is and was paid, or a new one of 10 hours bought today. */
export function toPackageValues(pkg: PackageView | undefined, clientId?: string): PackageFormValues {
  return {
    clientId: pkg?.clientId ?? clientId ?? "",
    hours: pkg ? String(pkg.hours) : "10",
    price: centsToInput(pkg?.priceCents),
    purchasedOn: pkg ? toISODate(new Date(pkg.purchasedAt)) : todayISO(),
    note: pkg?.note ?? "",
    paidBy: pkg?.paid?.method ?? "",
    paidOn: pkg?.paid?.paidOn ?? todayISO(),
  };
}

/**
 * What to send for a package: all of it for a new one, and only what
 * changed for an edit, since an update is a patch. Its payment goes only
 * when it changed, or with a new price, which a payment (always in full)
 * follows; never while it is locked (an issued receipt records it).
 */
export function toPackageFields(values: PackageFormValues, pkg: PackageView | undefined): PackageFields {
  const [year = 0, month = 1, day = 1] = values.purchasedOn.split("-").map(Number);
  // The day as it was keeps the time it was bought (a package bought in a
  // session is bought when the session is); another day starts with it, so
  // it covers that day's sessions.
  const sameDay = pkg !== undefined && toISODate(new Date(pkg.purchasedAt)) === values.purchasedOn;
  const fields: PackageFields = {};
  const hours = Number(values.hours);
  const priceCents = parseCents(values.price) ?? 0;
  if (!pkg || values.clientId !== pkg.clientId) fields.clientId = values.clientId;
  if (!pkg || hours !== pkg.hours) fields.hours = hours;
  if (!pkg || priceCents !== pkg.priceCents) fields.priceCents = priceCents;
  if (!sameDay) fields.purchasedAt = new Date(year, month - 1, day).toISOString();
  if (!pkg || values.note !== (pkg.note ?? "")) fields.note = values.note;
  if (pkg?.locked.payment) return fields;
  const paid = pkg?.paid;
  if (values.paidBy) {
    const again = paid?.method !== values.paidBy || paid.paidOn !== values.paidOn || (pkg !== undefined && fields.priceCents !== undefined);
    if (again) fields.payment = { payment: { method: values.paidBy, paidOn: values.paidOn } };
  } else if (paid) {
    fields.payment = {};
  }
  return fields;
}
