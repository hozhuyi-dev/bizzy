import { PACKAGE_FACETS } from "./packages.constant";
import type { PackageSearch, PackageView } from "./packages.types";
import type { ClientView } from "~/features/clients/clients.types";
import type { Facet, FilterPreset, ListFilter } from "~/core/list/filter.types";
import type { Payable } from "~/features/payments/payments.types";
import { clientFacet } from "~/features/clients/clients.util";
import { paperworkFacet, paperworkOf } from "~/features/documents/documents.util";
import { methodShortLabel } from "~/features/payments/payments.util";
import { NO_FILTER, filterUrl, whenDays } from "~/core/list/filter.util";
import { oneOf, textParam } from "~/core/utils/url-param.util";
import { formatDate, formatHours, toISODate } from "~/core/utils/date.util";

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

/** The packages list's filter in its URL: the open ones, unless it says otherwise. */
export const packagesUrl = filterUrl(PACKAGE_FACETS, undefined, { status: ["open"] });

/** The search a package's page takes: the list it steps through. */
export function validatePackageSearch(search: Record<string, unknown>): PackageSearch {
  return { ...packagesUrl.validate(search), from: oneOf(search.from, ["home"] as const), timeline: textParam(search.timeline) };
}

/** A client's packages, used up or not, latest bought first, as their page lists them: what one opened there steps through. */
export function clientPackagesSearch(clientId: string): PackageSearch {
  return packagesUrl.toSearch({ ...NO_FILTER, chips: { client: [clientId], status: [] } });
}

/** How a package stands, as the Status chip narrows by it; one can be more than one. */
type PackageStatus = "open" | "unpaid" | "used";

function statusesOf(pkg: PackageView): Array<PackageStatus> {
  const out: Array<PackageStatus> = [];
  // Still in use, or owed: as the API lists the open ones.
  if (pkg.creditsLeft > 0 || pkg.owedCents > 0) out.push("open");
  if (pkg.owedCents > 0) out.push("unpaid");
  if (pkg.creditsLeft <= 0) out.push("used");
  return out;
}

/** What the packages list can be narrowed by (PACKAGE_FACETS), besides the days bought. */
export function packageFacets(clients: ReadonlyArray<ClientView>): Array<Facet> {
  return [
    {
      key: "status",
      label: "Status",
      options: [
        { value: "open", label: "Open", keywords: ["credits"] },
        { value: "unpaid", label: "Unpaid", keywords: ["owed"] },
        { value: "used", label: "Used up" },
      ],
    },
    clientFacet(clients),
    paperworkFacet("invoice"),
    paperworkFacet("receipt"),
  ];
}

/** The ways the packages list is usually looked at; Open first, as it opens. */
export const PACKAGE_PRESETS: ReadonlyArray<FilterPreset> = [
  { label: "Open", when: undefined, chips: { status: ["open"] } },
  { label: "Unpaid", when: undefined, chips: { status: ["unpaid"] } },
  { label: "All", when: undefined, chips: { status: [] } },
];

/** Whether a package is one the filter's days and chips keep; the words are searched by the table. */
export function matchesPackage(pkg: PackageView, filter: ListFilter): boolean {
  const { status = [], client = [], invoice = [], receipt = [] } = filter.chips;
  const papers = paperworkOf(pkg);
  if (filter.when) {
    const { from, to } = whenDays(filter.when);
    const day = toISODate(new Date(pkg.purchasedAt));
    if (day < from || day > to) return false;
  }
  return (
    (status.length === 0 || statusesOf(pkg).some((s) => status.includes(s))) &&
    (client.length === 0 || client.includes(pkg.clientId)) &&
    (invoice.length === 0 || invoice.includes(papers.invoice)) &&
    (receipt.length === 0 || receipt.includes(papers.receipt))
  );
}
