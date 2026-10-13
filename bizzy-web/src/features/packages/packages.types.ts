import type { DocumentRef } from "~/features/documents/documents.types";
import type { Payment, PaymentInput } from "~/features/payments/payments.types";

// Mirrors bizzy-lambda/internal/features/packages/model.go.
export interface Package {
  id: string;
  clientId: string;
  sessions: number;
  /** The total price, however it was written (10x85 or 10@850). */
  priceCents: number;
  purchasedAt: string;
  /**
   * Bought in a session's title (`calendar`, keyed by its event), or added
   * here. A calendar package whose title no longer buys it becomes `app`.
   */
  source: "calendar" | "app";
  note?: string;
  creditsUsed: number;
  /** Settles its price, in full. */
  payment?: Payment;
  invoice?: DocumentRef;
  receipt?: DocumentRef;
}

export interface SavePackageInput {
  id?: string;
  clientId: string;
  sessions: number;
  priceCents: number;
  purchasedAt: string;
  note: string;
  /** Paid there and then, when adding it. */
  paid?: PaymentInput;
}

/** Open packages (credits left), or every one. */
export type PackagesView = "open" | "all";
