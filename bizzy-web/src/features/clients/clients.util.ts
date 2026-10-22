import { last12Months, monthsSinceLastSession, totals } from "./client-activity.util";
import { LAPSE_FACET, LAPSE_MONTHS, STANDING_FACETS } from "./clients.constant";
import type { LapseMonths, StandingFacet } from "./clients.constant";
import type { ChosenContact, ClientNext, ClientRow, ClientView, ClientsFilter, ClientsListSearch } from "./clients.types";
import type { ActivityView } from "~/features/activity/activity.types";
import type { ContactDetails, ContactView } from "~/features/contacts/contacts.types";
import type { Facet, ListFilter } from "~/core/list/filter.types";
import { filterUrl } from "~/core/list/filter.util";
import { oneOf } from "~/core/utils/url-param.util";

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

/** Reconnect's chip: clients lapsed for so many months. */
export function lapseFacet(): Facet {
  return {
    key: LAPSE_FACET,
    label: "Lapsed for",
    single: true,
    options: LAPSE_MONTHS.map((months) => ({ value: months, label: `Over ${months} months` })),
  };
}

const STANDING_OPTIONS: Record<StandingFacet, Facet> = {
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
  archived: { key: "archived", label: "Archived", single: true, options: [{ value: "yes", label: "Archived" }] },
};

/** What All clients is narrowed by besides words, made once: its options never change. */
export const CLIENT_FACETS: ReadonlyArray<Facet> = STANDING_FACETS.map((key) => STANDING_OPTIONS[key]);

/** What Reconnect is narrowed by besides words. */
export const RECONNECT_FACETS: ReadonlyArray<Facet> = [lapseFacet()];

/** A clients list's facets: its own view's. */
export function facetsOf(view: ClientsFilter): ReadonlyArray<Facet> {
  return view === "reconnect" ? RECONNECT_FACETS : CLIENT_FACETS;
}

/** The lapse a filter's chip asks for, if any: the list is Reconnect then. */
export function lapseOf(filter: ListFilter): LapseMonths | undefined {
  const lapse = filter.chips[LAPSE_FACET]?.[0];
  return LAPSE_MONTHS.find((months) => months === lapse);
}

/** Whether a client is where a filter's chips say: lapsed that long, booked, owing, and so on. */
export function matchesChips(row: ClientRow, chips: ListFilter["chips"]): boolean {
  const lapse = LAPSE_MONTHS.find((months) => months === chips[LAPSE_FACET]?.[0]);
  if (lapse && (row.activity?.lapsedMonths ?? 0) < Number(lapse)) return false;
  const chip = (key: StandingFacet) => chips[key]?.[0];
  const booked = chip("booked");
  if (booked && Boolean(row.activity?.nextBookedAt) !== (booked === "yes")) return false;
  if (chip("owes") && row.owedCents <= 0) return false;
  if (chip("credits") && row.creditsLeftMinutes <= 0) return false;
  if (chip("followUp") && !row.activity?.openFollowUps) return false;
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

/** All clients' filter both ways with its URL. */
export const clientsUrl = filterUrl(STANDING_FACETS);

/** The list a client's page steps through, from its URL: All clients' words and chips, or Reconnect's lapse. */
export function validateClientsListSearch(search: Record<string, unknown>): ClientsListSearch {
  // Numbers in the URL parse as numbers.
  return { ...clientsUrl.validate(search), lapse: oneOf(String(search.lapse), LAPSE_MONTHS) };
}

/** A clients list's filter as a client's page keeps it. */
export function clientsListSearch(filter: ListFilter): ClientsListSearch {
  return { ...clientsUrl.toSearch(filter), lapse: lapseOf(filter) };
}

/** The filter a client's page keeps: All clients' words and chips, or Reconnect with its lapse. */
export function clientsListFilter(search: ClientsListSearch): ListFilter {
  const filter = clientsUrl.toFilter(search);
  return search.lapse ? { ...filter, chips: { ...filter.chips, [LAPSE_FACET]: [search.lapse] } } : filter;
}

/** Reconnect's filter keeps a lapse: taking its chip off goes back to the shortest. */
export function withLapse(filter: ListFilter): ListFilter {
  return lapseOf(filter) ? filter : { ...filter, chips: { ...filter.chips, [LAPSE_FACET]: [LAPSE_MONTHS[0]] } };
}

/**
 * Where a clients filter is, and its name: Reconnect with a lapse (so the
 * nav shows it), All clients with its chips without.
 */
export function clientsListLink(filter: ListFilter) {
  const lapse = lapseOf(filter);
  const q = filter.text.trim() || undefined;
  if (lapse) {
    const search = { q, lapse: lapse === LAPSE_MONTHS[0] ? undefined : lapse, sort: filter.sort };
    return { to: "/clients/reconnect", label: "Reconnect", search } as const;
  }
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
