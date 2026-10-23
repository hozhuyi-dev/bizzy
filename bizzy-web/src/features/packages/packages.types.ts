import type { DocumentRef } from "~/features/documents/documents.types";
import type { Paid, PaymentInput } from "~/features/payments/payments.types";
import type { Locks, Verdict } from "~/core/lambda/lambda.types";

// Mirrors bizzy-lambda/internal/features/packages/api.go.

/** Why a package is on the to-do list; mirrors packages.Reason. */
export type PackageReason = "collect";

/** A package as the app shows it: what it costs and was paid, its credits, and what is left to do. */
export interface PackageView {
  id: string;
  clientId: string;
  /** Its credits, an hour each. */
  hours: number;
  purchasedAt: string;
  /** The session it was bought in (its title shows it); unset for one bought on its own. */
  boughtIn?: string;
  note?: string;
  /** Hours of its credits sessions use, and have left, by the half hour. */
  creditsUsed: number;
  creditsLeft: number;
  /** What its invoice charges. */
  priceCents: number;
  invoice?: DocumentRef;
  paid?: Paid;
  /** Its price while not received. */
  owedCents: number;
  todo: Array<PackageReason>;
  /** What each action on it would say now. */
  can: PackageCan;
  /** What its update can't change now. */
  locked: Locks;
}

/** What each action on a package would say now; mirrors packages.Can. */
export interface PackageCan {
  pay: Verdict;
  undoPayment: Verdict;
  /** Asking the client to pay for it on WhatsApp: it is owed. */
  askToPay: Verdict;
  /** Sending its documents for the client's records: one is issued. */
  sendRecords: Verdict;
  /** Keeping one bought in a session as one on its own. */
  makeStandalone: Verdict;
  /** Only one bought by mistake: unused, unpaid, on no issued invoice. */
  delete: Verdict;
}

/**
 * What packages.create and packages.update set; mirrors packages.Fields. An
 * update is a patch: what isn't sent stays as it is.
 */
export interface PackageFields {
  clientId?: string;
  hours?: number;
  priceCents?: number;
  purchasedAt?: string;
  note?: string;
  /** Paid there and then. */
  paid?: PaymentInput;
  /** Move what was received for it to a new price, on a receipt not issued yet. */
  updatePayment?: boolean;
}
