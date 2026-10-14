import type { Package, SavePackageInput } from "./packages.types";
import type { PaymentMethod } from "~/features/payments/payments.types";
import { centsToInput, parseCents } from "~/core/utils/money.util";
import { toISODate, todayISO } from "~/core/utils/date.util";

export interface PackageFormValues {
  clientId: string;
  sessions: string;
  /** Total price, as she'd write after the @. */
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
export function toPackageValues(pkg: Package | undefined): PackageFormValues {
  return {
    clientId: pkg?.clientId ?? "",
    sessions: pkg ? String(pkg.sessions) : "10",
    price: centsToInput(pkg?.priceCents),
    purchasedOn: pkg ? toISODate(new Date(pkg.purchasedAt)) : todayISO(),
    note: pkg?.note ?? "",
    paid: false,
    paidBy: "",
    updatePayment: false,
  };
}

export function toPackageInput(values: PackageFormValues, pkg: Package | undefined): SavePackageInput {
  const [year = 0, month = 1, day = 1] = values.purchasedOn.split("-").map(Number);
  // The day as it was keeps the time it was bought (a package bought in a
  // session is bought when the session is); another day starts with it, so
  // it covers that day's sessions.
  const sameDay = pkg && toISODate(new Date(pkg.purchasedAt)) === values.purchasedOn;
  return {
    ...(pkg ? { id: pkg.id } : {}),
    clientId: values.clientId,
    sessions: Number(values.sessions),
    priceCents: parseCents(values.price) ?? 0,
    purchasedAt: sameDay ? pkg.purchasedAt : new Date(year, month - 1, day).toISOString(),
    note: values.note,
    ...(values.paid && values.paidBy ? { paid: { method: values.paidBy, paidOn: values.purchasedOn } } : {}),
    ...(values.updatePayment ? { updatePayment: true } : {}),
  };
}
