import type { PackageFields, PackageView } from "./packages.types";
import type { ClientView } from "~/features/clients/clients.types";
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
  /** The other clients its credits are for. */
  sharedWith: Array<string>;
  /** Who pays for it. */
  billTo: string;
  /** A new one's: how it was paid there and then; blank leaves it to collect. */
  paidBy: PaymentMethod | "";
  /** The day it was paid, once it is. */
  paidOn: string;
  /** What was received moves to a new price (a receipt not issued yet). */
  updatePayment: boolean;
}

/**
 * A package to edit, as it is and was paid, or a new one of 10 hours bought
 * today, shared and billed as its client (when known) says (see sharedFor).
 */
export function toPackageValues(pkg: PackageView | undefined, clientId?: string, client?: ClientView): PackageFormValues {
  return {
    ...(pkg ? { sharedWith: pkg.sharedWith, billTo: pkg.payer } : sharedFor(client)),
    clientId: pkg?.clientId ?? clientId ?? "",
    hours: pkg ? String(pkg.hours) : "10",
    price: centsToInput(pkg?.priceCents),
    purchasedOn: pkg ? toISODate(new Date(pkg.purchasedAt)) : todayISO(),
    note: pkg?.note ?? "",
    paidBy: "",
    paidOn: todayISO(),
    updatePayment: false,
  };
}

/** Whom a new package of a client's is shared with and billed to: as they buy, by default. */
export function sharedFor(client: ClientView | undefined): Pick<PackageFormValues, "sharedWith" | "billTo"> {
  return { sharedWith: client?.sharesWith ?? [], billTo: client ? (client.billTo ?? client.id) : "" };
}

/**
 * What to send for a package: all of it for a new one, with what was paid
 * there and then, and only what changed for an edit, since an update is a
 * patch. A payment is recorded and undone as itself afterwards (Mark paid);
 * an edit only moves one to a new price, when asked.
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
  if (!pkg || values.sharedWith.join(",") !== pkg.sharedWith.join(",")) fields.sharedWith = values.sharedWith;
  if (values.billTo && values.billTo !== pkg?.payer) fields.billTo = values.billTo;
  if (!pkg && values.paidBy) fields.payment = { payment: { method: values.paidBy, paidOn: values.paidOn } };
  if (pkg && values.updatePayment && fields.priceCents !== undefined) fields.updatePayment = true;
  return fields;
}
