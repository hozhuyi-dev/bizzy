import type { Package } from "./packages.types";
import type { Client } from "~/features/clients/clients.types";
import { methodShortLabel } from "~/features/payments/payments.util";
import { formatDate } from "~/core/utils/date.util";

export function clientName(pkg: Package, clientsById: ReadonlyMap<string, Client>): string {
  return clientsById.get(pkg.clientId)?.name ?? "Unknown client";
}

/** "Paid · TnG · 12 Oct", "Free" or "Unpaid". */
export function paymentText(pkg: Package): string {
  const { paid } = pkg;
  if (!paid) return pkg.owedCents === 0 ? "Free" : "Unpaid";
  return ["Paid", methodShortLabel(paid.method), formatDate(paid.paidOn)].filter(Boolean).join(" · ");
}
