// Mirrors bizzy-lambda/internal/features/clients/model.go.
export interface Client {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  postcode?: string;
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

export interface MonthActivity {
  sessions: number;
  homeSessions?: number;
  /** Paid that month: session fees, and packages when bought. */
  receivedCents: number;
  /** Sessions valued as they happen; package sessions at their share. */
  earnedCents: number;
  homeEarnedCents?: number;
}

/** The fields she edits; a new client has no id yet. */
export type SaveClientInput = Pick<
  Client,
  "name" | "email" | "phone" | "address" | "postcode" | "aliases" | "defaultFeeCents" | "homeVisits"
> & { id?: string };
