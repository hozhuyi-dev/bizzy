import type { PackageFields, PackageView } from "./packages.types";
import type { PaymentMethod } from "~/features/payments/payments.types";
import { centsToInput, parseCents } from "~/core/utils/money.util";
import { toISODate, todayISO } from "~/core/utils/date.util";

export interface PackageFormValues {
  clientId: string;
  sessions: string;
  /** Total price, as written after the @. */
  price: string;
  purchasedOn: string;
  note: string;
  /** Paid there and then: how. Unset leaves it to collect. */
  paidBy: PaymentMethod | "";
  paid: boolean;
  /** Move what was received to a new price, on a receipt not issued yet. */
  updatePayment: boolean;
}

/** A package to edit, or a new one of 10 bought today. */
export function toPackageValues(pkg: PackageView | undefined, clientId?: string): PackageFormValues {
  return {
    clientId: pkg?.clientId ?? clientId ?? "",
    sessions: pkg ? String(pkg.sessions) : "10",
    price: centsToInput(pkg?.priceCents),
    purchasedOn: pkg ? toISODate(new Date(pkg.purchasedAt)) : todayISO(),
    note: pkg?.note ?? "",
    paid: false,
    paidBy: "",
    updatePayment: false,
  };
}

/**
 * What to send for a package: all of it for a new one, and only what
 * changed for an edit, since an update is a patch.
 */
export function toPackageFields(values: PackageFormValues, pkg: PackageView | undefined): PackageFields {
  const [year = 0, month = 1, day = 1] = values.purchasedOn.split("-").map(Number);
  // The day as it was keeps the time it was bought (a package bought in a
  // session is bought when the session is); another day starts with it, so
  // it covers that day's sessions.
  const sameDay = pkg !== undefined && toISODate(new Date(pkg.purchasedAt)) === values.purchasedOn;
  const fields: PackageFields = {};
  const sessions = Number(values.sessions);
  const priceCents = parseCents(values.price) ?? 0;
  if (!pkg || values.clientId !== pkg.clientId) fields.clientId = values.clientId;
  if (!pkg || sessions !== pkg.sessions) fields.sessions = sessions;
  if (!pkg || priceCents !== pkg.priceCents) fields.priceCents = priceCents;
  if (!sameDay) fields.purchasedAt = new Date(year, month - 1, day).toISOString();
  if (!pkg || values.note !== (pkg.note ?? "")) fields.note = values.note;
  if (values.paid && values.paidBy) fields.paid = { method: values.paidBy, paidOn: values.purchasedOn };
  if (values.updatePayment) fields.updatePayment = true;
  return fields;
}
