import type { PackageView, PackagesFilter } from "./packages.types";
import type { ClientView } from "~/features/clients/clients.types";
import type { Facet, ListFilter } from "~/core/filter/filter.types";
import type { Payable } from "~/features/payments/payments.types";
import { clientFacet } from "~/features/clients/clients.util";
import { methodShortLabel } from "~/features/payments/payments.util";
import { formatDate, formatHours } from "~/core/utils/date.util";

export function clientName(pkg: PackageView, clientsById: ReadonlyMap<string, ClientView>): string {
  return clientsById.get(pkg.clientId)?.name ?? "Unknown client";
}

/** "Paid · TnG · 12 Oct", "Free" or "Unpaid". */
export function paymentText(pkg: PackageView): string {
  const { paid } = pkg;
  if (!paid) return pkg.owedCents === 0 ? "Free" : "Unpaid";
  return ["Paid", methodShortLabel(paid.method), formatDate(paid.paidOn)].filter(Boolean).join(" · ");
}

/** What a package's payment panel shows: its payment, or what it owes. */
export function packagePayables(pkg: PackageView): Array<Payable> {
  const item = { kind: "package", id: pkg.id } as const;
  const label = `Package of ${formatHours(pkg.hours)}`;
  if (pkg.paid) return [{ item, label, dueCents: 0, paid: pkg.paid }];
  return pkg.owedCents > 0 ? [{ item, label, dueCents: pkg.owedCents }] : [];
}

/** What the packages list can be narrowed by (PACKAGE_FACETS). */
export function packageFacets(clients: ReadonlyArray<ClientView>): Array<Facet> {
  return [
    // Still in use, or owed: the API says which.
    { key: "status", label: "Status", single: true, options: [{ value: "open", label: "Open" }] },
    clientFacet(clients),
  ];
}

/** Which packages to load: the open ones while the Open chip is on. */
export function packagesView(filter: ListFilter): PackagesFilter {
  return filter.chips.status?.includes("open") ? "open" : "all";
}
