// Mirrors bizzy-lambda/internal/features/clients/model.go.
export interface Client {
  id: string;
  /** Hers to choose; the Google contact may be named differently. */
  name: string;
  /** The linked Google contact, where the client's details live. */
  contact?: ClientContact;
  /** Names she writes in the calendar; always includes the client's name. */
  aliases: Array<string>;
  defaultFeeCents?: number;
  /** Sessions are home visits unless the event colour says otherwise. */
  homeVisits?: boolean;

  /** Keyed by month ("2026-10"); kept up to date by the API. */
  activity?: Record<string, MonthActivity>;
  lastSessionAt?: string;
  nextBookedAt?: string;
  lastContactedAt?: string;
}

/**
 * A read-only copy of the linked Google contact. Edits go to Google, and the
 * nightly sync refreshes the copy.
 */
export interface ClientContact {
  resourceName: string;
  etag?: string;
  displayName?: string;
  email?: string;
  phone?: string;
  /** Printed on receipts. */
  address?: string;
  postcode?: string;
  /** No longer in Google (deleted or merged); the copy is kept. */
  missing?: boolean;
  syncedAt: string;
}

export interface MonthActivity {
  sessions: number;
  homeSessions?: number;
  /** Paid that month: session fees, and packages when bought. */
  receivedCents: number;
  /** Sessions valued as they happen; package sessions at their share. */
  earnedCents: number;
  homeEarnedCents?: number;
}

/**
 * The fields she edits; a new client has no id yet. Only the contact's
 * resource name is sent: the API copies the details from Google. An existing
 * client saved without one is unlinked.
 */
export type SaveClientInput = Pick<Client, "name" | "aliases" | "defaultFeeCents" | "homeVisits"> & {
  id?: string;
  contact?: { resourceName: string };
};
