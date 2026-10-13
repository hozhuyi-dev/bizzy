import { last12Months, monthsSinceLastSession, totals } from "./client-activity.util";
import type { ChosenContact, Client, ClientRow, SaveClientInput } from "./clients.types";
import type { Contact, ContactDetails } from "~/features/contacts/contacts.types";

/** The client an item is for, when it has one and it still exists. */
export function clientOf(clientsById: ReadonlyMap<string, Client>, clientId: string | undefined): Client | undefined {
  return clientId ? clientsById.get(clientId) : undefined;
}

export function toClientRow(client: Client, now = new Date()): ClientRow {
  const year = last12Months(client, now);
  return {
    client,
    lastSessionAt: client.lastSessionAt,
    monthsSince: monthsSinceLastSession(client, now),
    revenue12Cents: year.receivedCents,
    lifetimeCents: totals(client).receivedCents,
    sessions12: year.sessions,
  };
}

/** Aliases other than the client's own name, which is always one of them. */
export function extraAliases(client: Client): Array<string> {
  const name = client.name.toLowerCase();
  return client.aliases.filter((alias) => alias !== name);
}

/** Says when the client's Google contact needs her attention. */
export function contactProblem(client: Client): string | undefined {
  if (!client.contact) return "No contact";
  if (client.contact.missing) return "Contact deleted in Google";
  return undefined;
}

/**
 * The editable part of a client, to save it back with a change. Every client
 * is created with a contact, so a missing one only fails loudly on save.
 */
export function profileOf(client: Client): SaveClientInput {
  return {
    id: client.id,
    name: client.name,
    aliases: client.aliases,
    ...(client.contact ? { contact: { resourceName: client.contact.resourceName } } : {}),
    ...(client.defaultFeeCents !== undefined ? { defaultFeeCents: client.defaultFeeCents } : {}),
    ...(client.homeVisits ? { homeVisits: true } : {}),
  };
}

export function chosenFromContact(contact: Contact): ChosenContact {
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
