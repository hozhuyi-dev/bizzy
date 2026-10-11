// Mirrors bizzy-lambda/internal/features/contacts.
export interface ContactAddress {
  /** May run over several lines. */
  street?: string;
  city?: string;
  postcode?: string;
  region?: string;
  /** The whole address as Google prints it (read only). */
  formatted?: string;
}

/** A Google contact: its primary email, phone and address. */
export interface Contact {
  resourceName: string;
  /** The version read; an edit against an older one is refused. */
  etag: string;
  displayName?: string;
  givenName?: string;
  familyName?: string;
  nicknames?: Array<string>;
  email?: string;
  phone?: string;
  address: ContactAddress;
}

/** What she edits from the app. The name is only set on a new contact. */
export interface ContactDetails {
  givenName?: string;
  familyName?: string;
  email: string;
  phone: string;
  address: ContactAddress;
}

/** A contact she said is not a client. */
export interface DismissedContact {
  resourceName: string;
  displayName: string;
}

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
