import type { Package } from "./packages.types";
import type { Client } from "~/features/clients/clients.types";
import { methodShortLabel } from "~/features/payments/payments.util";
import { formatDate } from "~/core/utils/date.util";

/** The package a session's title bought, while it still does. */
export function boughtIn(sessionId: string, pkg: Package | undefined): Package | undefined {
  return pkg && pkg.id === sessionId && pkg.source === "calendar" ? pkg : undefined;
}

export function clientName(pkg: Package, clientsById: ReadonlyMap<string, Client>): string {
  return clientsById.get(pkg.clientId)?.name ?? "Unknown client";
}

/** "Paid · TnG · 12 Oct", "Waived" or "Unpaid". */
export function paymentText(pkg: Package): string {
  const { payment } = pkg;
  if (!payment) return pkg.owedCents === 0 ? "Free" : "Unpaid";
  if (payment.status === "waived") return "Waived";
  const method = methodShortLabel(payment.method);
  return ["Paid", method, formatDate(payment.paidOn)].filter(Boolean).join(" · ");
}
