import type { Contact } from "./contacts.types";

/** Opens the contact in Google Contacts. */
export function contactUrl(resourceName: string): string {
  return `https://contacts.google.com/person/${resourceName.replace(/^people\//, "")}`;
}

/** Contacts whose name, nickname, email or phone matches what she typed. */
export function searchContacts(contacts: ReadonlyArray<Contact>, query: string): Array<Contact> {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...contacts];

  const digits = query.replace(/\D/g, "");
  const matches = contacts.filter((contact) => {
    const text = [contact.displayName, ...(contact.nicknames ?? []), contact.email]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (words.every((word) => text.includes(word))) return true;
    return digits.length >= 4 && (contact.phone ?? "").replace(/\D/g, "").includes(digits);
  });

  // Names starting with what she typed first.
  const first = words[0] ?? "";
  const starts = (contact: Contact) => (contact.displayName ?? "").toLowerCase().startsWith(first);
  return matches.sort((a, b) => Number(starts(b)) - Number(starts(a)));
}
