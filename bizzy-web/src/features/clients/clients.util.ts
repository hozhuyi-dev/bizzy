import { last12Months, monthsSinceLastSession, totals } from "./client-activity.util";
import type { ChosenContact, ClientRow, ClientView } from "./clients.types";
import type { ActivityView } from "~/features/activity/activity.types";
import type { ContactDetails, ContactView } from "~/features/contacts/contacts.types";

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
