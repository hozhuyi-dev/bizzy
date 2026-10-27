import { last12Months, monthsSinceLastSession, totals } from "./client-activity.util";
import { CLIENT_FACET_KEYS, LAPSE_MONTHS, MISSING_DETAILS } from "./clients.constant";
import type { ClientFacetKey, MissingDetail } from "./clients.constant";
import type { ChosenContact, ClientNext, ClientRow, ClientView } from "./clients.types";
import type { ActivityView } from "~/features/activity/activity.types";
import type { ContactDetails, ContactView } from "~/features/contacts/contacts.types";
import type { Facet, FilterPreset, ListFilter } from "~/core/list/filter.types";
import { filterUrl } from "~/core/list/filter.util";
import { formatHours } from "~/core/utils/date.util";

/** The client an item is for, when it has one and it still exists. */
export function clientOf(clientsById: ReadonlyMap<string, ClientView>, clientId: string | undefined): ClientView | undefined {
  return clientId ? clientsById.get(clientId) : undefined;
}

export function toClientRow(client: ClientView, activity: ActivityView | undefined, now = new Date()): ClientRow {
  const year = last12Months(activity, now);
  return {
    client,
    activity,
    lastSessionAt: activity?.lastSessionAt,
    monthsSince: monthsSinceLastSession(activity, now),
    revenue12Cents: year.receivedCents,
    lifetimeCents: totals(activity).receivedCents,
    sessions12: year.sessions,
    owedCents: activity?.owedCents ?? 0,
    creditsLeftMinutes: activity?.creditsLeftMinutes ?? 0,
    sharedCreditsLeftMinutes: activity?.sharedCreditsLeftMinutes ?? 0,
    next: nextOf(activity),
    lastContactedAt: activity?.lastContactedAt,
  };
}

/** What is next with a client: the session booked, else the follow-up due. */
function nextOf(activity: ActivityView | undefined): ClientNext | undefined {
  if (activity?.nextBookedAt) return { kind: "session", at: activity.nextBookedAt };
  if (activity?.nextFollowUpAt) return { kind: "followUp", at: activity.nextFollowUpAt };
  return undefined;
}

/** The client's other calendar names, leaving out one that is just their name. */
export function extraAliases(client: ClientView): Array<string> {
  const name = client.name.toLowerCase();
  return client.aliases.filter((alias) => alias !== name);
}

/** Clients to narrow a list to, A to Z, found by name or calendar name. */
export function clientFacet(clients: ReadonlyArray<ClientView>): Facet {
  return {
    key: "client",
    label: "Client",
    options: [...clients]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((client) => ({ value: client.id, label: client.name, keywords: extraAliases(client) })),
  };
}

const CLIENT_FACET_BY_KEY: Record<ClientFacetKey, Facet> = {
  lapse: {
    key: "lapse",
    label: "Lapsed for",
    single: true,
    options: LAPSE_MONTHS.map((months) => ({ value: months, label: `Over ${months} months`, keywords: ["reconnect"] })),
  },
  booked: {
    key: "booked",
    label: "Booked",
    single: true,
    options: [
      { value: "yes", label: "Booked" },
      { value: "no", label: "Not booked" },
    ],
  },
  owes: { key: "owes", label: "Owes", single: true, options: [{ value: "yes", label: "Owes money", keywords: ["unpaid"] }] },
  credits: { key: "credits", label: "Credits", single: true, options: [{ value: "yes", label: "Has credits", keywords: ["package"] }] },
  followUp: { key: "followUp", label: "Follow-up", single: true, options: [{ value: "yes", label: "Open follow-up" }] },
  homeVisits: { key: "homeVisits", label: "Visits", single: true, options: [{ value: "yes", label: "Home visits" }] },
  missing: {
    key: "missing",
    label: "Missing",
    options: Object.entries(MISSING_DETAILS).map(([value, label]) => ({ value, label })),
  },
  archived: { key: "archived", label: "Archived", single: true, options: [{ value: "yes", label: "Archived" }] },
};

/** What the clients list is narrowed by besides words, made once: its options never change. */
export const CLIENT_FACETS: ReadonlyArray<Facet> = CLIENT_FACET_KEYS.map((key) => CLIENT_FACET_BY_KEY[key]);

/**
 * The ways the clients list is usually looked at. Reconnect is those not
 * seen in over 3 months with nothing booked or waiting, most valuable
 * first; its chip can be added to any other.
 */
export const CLIENT_PRESETS: ReadonlyArray<FilterPreset> = [
  { label: "Active", when: undefined, chips: {} },
  { label: "Reconnect", when: undefined, chips: { lapse: [LAPSE_MONTHS[0]] }, sort: "-lifetimeCents" },
  { label: "Owes money", when: undefined, chips: { owes: ["yes"] } },
  { label: "Has credits", when: undefined, chips: { credits: ["yes"] } },
  { label: "Missing details", when: undefined, chips: { missing: ["phone", "idNo"] } },
  { label: "Archived", when: undefined, chips: { archived: ["yes"] } },
];

/** The details a client is missing. */
export function missingDetails(client: ClientView): Array<MissingDetail> {
  const out: Array<MissingDetail> = [];
  if (!client.contact?.phone) out.push("phone");
  if (!client.idNo) out.push("idNo");
  if (contactProblem(client)) out.push("contact");
  return out;
}

/** Lapsed: no session in a while, nothing booked and nothing waiting; worth getting back in touch with. */
export function isLapsed(row: ClientRow): boolean {
  return (row.activity?.lapsedMonths ?? 0) > 0;
}

/** Whether a client is where a filter's chips say: lapsed that long, booked, owing, and so on. */
export function matchesChips(row: ClientRow, chips: ListFilter["chips"]): boolean {
  const chip = (key: ClientFacetKey) => chips[key]?.[0];
  const lapse = LAPSE_MONTHS.find((months) => months === chip("lapse"));
  if (lapse && (row.activity?.lapsedMonths ?? 0) < Number(lapse)) return false;
  const booked = chip("booked");
  if (booked && Boolean(row.activity?.nextBookedAt) !== (booked === "yes")) return false;
  if (chip("owes") && row.owedCents <= 0) return false;
  if (chip("credits") && row.creditsLeftMinutes + row.sharedCreditsLeftMinutes <= 0) return false;
  if (chip("followUp") && !row.activity?.openFollowUps) return false;
  if (chip("homeVisits") && !row.client.homeVisits) return false;
  const missing = chips.missing ?? [];
  if (missing.length > 0 && !missingDetails(row.client).some((detail) => missing.includes(detail))) return false;
  // Archived clients are put away: only their chip shows them.
  return Boolean(row.client.archivedAt) === Boolean(chip("archived"));
}

/**
 * The clients a picker offers, A to Z: not the archived, unless one is
 * already chosen (keepId), which stays.
 */
export function pickableClients(clients: ReadonlyArray<ClientView>, keepId?: string): Array<{ value: string; label: string }> {
  return clients
    .filter((client) => !client.archivedAt || client.id === keepId)
    .map((client) => ({ value: client.id, label: client.name }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** The clients list's filter both ways with its URL; a client's page keeps it too, to step through. */
export const clientsUrl = filterUrl(CLIENT_FACET_KEYS);

/** Where a clients filter is, and its name. */
export function clientsListLink(filter: ListFilter) {
  return { to: "/clients", label: "Clients", search: clientsUrl.toSearch(filter) } as const;
}

/** Says when the client's Google contact needs the user's attention. */
export function contactProblem(client: ClientView): string | undefined {
  if (!client.contact) return "No contact";
  if (client.contact.missing) return "Contact deleted in Google";
  return undefined;
}

export function chosenFromContact(contact: ContactView): ChosenContact {
  return {
    resourceName: contact.resourceName,
    displayName: contact.displayName,
    email: contact.email,
    phone: contact.phone,
    address: contact.address.formatted,
    postcode: contact.address.postcode,
  };
}

/** A new contact prefilled from a deleted one's copy, for her to check. */
export function recreateFrom(contact: ChosenContact, clientName: string | undefined): ContactDetails {
  return {
    givenName: contact.displayName || clientName || "",
    email: contact.email ?? "",
    phone: contact.phone ?? "",
    address: {
      street: contact.address ?? "",
      ...(contact.postcode ? { postcode: contact.postcode } : {}),
    },
  };
}

/**
 * "2 h left · 6 h shared": what their packages have left, and what those
 * shared with them have (others', so never added up); undefined with none.
 */
export function creditsText(row: Pick<ClientRow, "creditsLeftMinutes" | "sharedCreditsLeftMinutes">): string | undefined {
  const parts = [
    row.creditsLeftMinutes > 0 ? `${formatHours(row.creditsLeftMinutes / 60)} left` : "",
    row.sharedCreditsLeftMinutes > 0 ? `${formatHours(row.sharedCreditsLeftMinutes / 60)} shared` : "",
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}
