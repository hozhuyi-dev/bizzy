import type { ClientFacetKey } from "./clients.constant";
import type { ActivityView } from "~/features/activity/activity.types";
import type { ContactSummaryValue } from "~/features/contacts/contacts.types";
import type { FilterSearch } from "~/core/list/filter.types";
import type { Verdict } from "~/core/lambda/lambda.types";

// Mirrors bizzy-lambda/internal/features/clients/api.go and client.go.

/** A client as the app shows it; mirrors clients.View. */
export interface ClientView {
  id: string;
  /** The user's to choose; the Google contact may be named differently. */
  name: string;
  /** Other names the user's calendar titles call the client by. */
  aliases: Array<string>;
  /**
   * The usual hourly fee, charged for what package credits leave of a session
   * with no fee typed when it is booked; unset when none is set. A session's
   * invoice line keeps what it was charged.
   */
  feeCents?: number;
  /** Sessions are home visits unless their title says (H). */
  homeVisits: boolean;
  /** IC (MyKad, as 900101-14-5678) or passport number, printed under their name on documents. */
  idNo?: string;
  /** Clients their new packages are shared with by default (a family): each package keeps its own list. */
  sharesWith: Array<string>;
  /** Who pays for their new sessions and packages by default; unset when they pay for themselves. */
  billTo?: string;
  /** The name documents they pay for are made out to (a company), in place of theirs. */
  billingName?: string;
  /** Printed under the billing name (a registration number), in place of their IC. */
  billingIdNo?: string;
  /** The linked Google contact, where the client's details live. */
  contact?: ClientContact;
  /** When the user put them away: kept with all that is theirs, out of lists and pickers, not booked until unarchived. */
  archivedAt?: string;
  can: ClientCan;
}

/** What each action on a client would say now; mirrors clients.Can. */
export interface ClientCan {
  archive: Verdict;
  unarchive: Verdict;
  /** Only one added by mistake, with nothing of theirs: the others are archived. */
  delete: Verdict;
}

/**
 * A read-only copy of the linked Google contact; mirrors clients.Contact.
 * Edits go to Google, and the sync refreshes the copy.
 */
export interface ClientContact {
  resourceName: string;
  etag?: string;
  displayName?: string;
  email?: string;
  phone?: string;
  /** Copied onto documents, not printed. */
  address?: string;
  postcode?: string;
  /** No longer in Google (deleted or merged); the copy is kept. */
  missing?: boolean;
  syncedAt: string;
}

/**
 * What clients.create and clients.update set; mirrors clients' saveRequest.
 * An update is a patch: what isn't sent stays as it is. Only the contact's
 * resource name is sent, and the API copies the details from Google; `""`
 * unlinks it.
 */
export interface ClientFields {
  name?: string;
  aliases?: Array<string>;
  /** The usual hourly fee; `{}` clears it. */
  fee?: { cents?: number };
  homeVisits?: boolean;
  /** `""` clears it. */
  idNo?: string;
  sharesWith?: Array<string>;
  /** `""` clears these. */
  billTo?: string;
  billingName?: string;
  billingIdNo?: string;
  contact?: { resourceName: string };
}

/** A client's activity summed over a span of months. */
export interface ActivityTotals {
  sessions: number;
  homeSessions: number;
  receivedCents: number;
  earnedCents: number;
  homeEarnedCents: number;
}

/** A client with the figures the table sorts by. */
export interface ClientRow {
  client: ClientView;
  activity: ActivityView | undefined;
  lastSessionAt: string | undefined;
  monthsSince: number | undefined;
  revenue12Cents: number;
  lifetimeCents: number;
  sessions12: number;
  owedCents: number;
  creditsLeftMinutes: number;
  /** What packages shared with them have left: others' credits, never added to their own. */
  sharedCreditsLeftMinutes: number;
  next: ClientNext | undefined;
  lastContactedAt: string | undefined;
}

/** What is next with a client: the session booked, else the follow-up due (which may be past). */
export interface ClientNext {
  kind: "session" | "followUp";
  at: string;
}

/** The clients list's filter, as its URL and a client's page (to step through it) keep it. */
export type ClientsListSearch = FilterSearch<ClientFacetKey>;

/** A contact chosen for the client, with whatever details are known. */
export interface ChosenContact extends ContactSummaryValue {
  postcode?: string | undefined;
  missing?: boolean | undefined;
}
