import type { DocumentRef } from "~/features/documents/documents.types";
import type { Paid, PaymentInput } from "~/features/payments/payments.types";

// Mirrors bizzy-lambda/internal/features/packages/api.go.

/** Why a package is on the to-do list; mirrors packages.Reason. */
export type PackageReason = "collect";

/** A package as the app shows it: what it costs and was paid, its credits, and what is left to do. */
export interface PackageView {
  id: string;
  clientId: string;
  sessions: number;
  purchasedAt: string;
  /** The session it was bought in (its title shows it); unset for one bought on its own. */
  boughtIn?: string;
  note?: string;
  /** How many sessions its credits pay for. */
  creditsUsed: number;
  creditsLeft: number;
  /** What its invoice charges. */
  priceCents: number;
  invoice?: DocumentRef;
  paid?: Paid;
  /** Its price while not received. */
  owedCents: number;
  todo: Array<PackageReason>;
}

/**
 * What packages.create and packages.update set; mirrors packages.Fields. An
 * update is a patch: what isn't sent stays as it is.
 */
export interface PackageFields {
  clientId?: string;
  sessions?: number;
  priceCents?: number;
  purchasedAt?: string;
  note?: string;
  /** Paid there and then. */
  paid?: PaymentInput;
  /** Move what was received for it to a new price, on a receipt not issued yet. */
  updatePayment?: boolean;
}

/** Open packages (credits left, or still owed), or every one. */
export type PackagesFilter = "open" | "all";
