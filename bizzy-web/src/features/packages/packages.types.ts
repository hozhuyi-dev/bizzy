import type { DocumentRef } from "~/features/documents/documents.types";
import type { Payment, PaymentInput } from "~/features/payments/payments.types";
import type { TodoReason } from "~/features/sessions/sessions.types";
import type { Verdict } from "~/core/lambda/lambda.types";

// Mirrors bizzy-lambda/internal/features/packages/model.go and view.go.
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
  /** How the calendar now disagrees with an issued document covering it: its event names another client, or moved. */
  drift?: string;
  /** Settles its price, in full. */
  payment?: Payment;
  invoice?: DocumentRef;
  receipt?: DocumentRef;

  // What the API's rules (packages/rules.go) and guards (guards.go) make of
  // it as of the request. Read these; never re-derive them here.
  /** The rules that hold, in priority order. */
  rules: Array<string>;
  /** What is left to do on it now. */
  todo: Array<TodoReason>;
  /** What to fix, explained. */
  problem?: string;
  creditsLeft: number;
  /** Its price while not paid, waived or free. */
  owedCents: number;
  can: PackageCan;
}

/** What each action on a package would say now; mirrors packages.Can. */
export interface PackageCan {
  pay: Verdict;
  invoice: Verdict;
  receipt: Verdict;
  edit: Verdict;
  delete: Verdict;
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
