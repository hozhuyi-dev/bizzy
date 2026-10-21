import { last12Months, monthsSinceLastSession, totals } from "./client-activity.util";
import { LAPSE_FACET, LAPSE_MONTHS } from "./clients.constant";
import type { LapseMonths } from "./clients.constant";
import type { ChosenContact, ClientRow, ClientView, ClientsListSearch } from "./clients.types";
import type { ActivityView } from "~/features/activity/activity.types";
import type { ContactDetails, ContactView } from "~/features/contacts/contacts.types";
import type { Facet, ListFilter } from "~/core/list/filter.types";
import { oneOf, textParam } from "~/core/utils/search.util";

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
  };
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

/** Reconnect, as a chip: clients with no session in so many months. */
export function lapseFacet(): Facet {
  return {
    key: LAPSE_FACET,
    label: "Last session",
    single: true,
    options: LAPSE_MONTHS.map((months) => ({ value: months, label: `Over ${months} months ago` })),
  };
}

/** What the clients lists can be narrowed by besides words, made once: its options never change. */
export const CLIENT_FACETS: ReadonlyArray<Facet> = [lapseFacet()];

/** The lapse a filter's chip asks for, if any: the list is Reconnect then. */
export function lapseOf(filter: ListFilter): LapseMonths | undefined {
  const lapse = filter.chips[LAPSE_FACET]?.[0];
  return LAPSE_MONTHS.find((months) => months === lapse);
}

/** The list a client's page steps through, from its URL: the words, and the lapse of Reconnect. */
export function validateClientsListSearch(search: Record<string, unknown>): ClientsListSearch {
  // Numbers in the URL parse as numbers.
  return { q: textParam(search.q), lapse: oneOf(String(search.lapse), LAPSE_MONTHS) };
}

/** The clients list's filter as a client's page keeps it. */
export function clientsListSearch(filter: ListFilter): ClientsListSearch {
  return { q: filter.text.trim() || undefined, lapse: lapseOf(filter) };
}

/** The filter a client's page keeps: All clients, or Reconnect with its lapse. */
export function clientsListFilter(search: ClientsListSearch): ListFilter {
  return { text: search.q ?? "", when: undefined, chips: search.lapse ? { [LAPSE_FACET]: [search.lapse] } : {} };
}

/**
 * Where a clients filter is, and its name: Reconnect with a Last session
 * chip (so the nav shows it), All clients without.
 */
export function clientsListLink(filter: ListFilter) {
  const lapse = lapseOf(filter);
  const q = filter.text.trim() || undefined;
  if (lapse) {
    const search = { q, lapse: lapse === LAPSE_MONTHS[0] ? undefined : lapse };
    return { to: "/clients/reconnect", label: "Reconnect", search } as const;
  }
  return { to: "/clients", label: "Clients", search: { q } } as const;
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
