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

/** The contact details a client shows: a contact, or the client's copy of it. */
export interface ContactSummaryValue {
  resourceName: string;
  displayName?: string | undefined;
  email?: string | undefined;
  phone?: string | undefined;
  address?: string | undefined;
}
