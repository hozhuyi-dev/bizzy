import type { DocumentRef } from "~/features/documents/documents.types";
import type { Paid, PaymentInput } from "~/features/payments/payments.types";
import type { Verdict } from "~/core/lambda/lambda.types";

// Mirrors bizzy-lambda/internal/features/packages/model.go and view.go.
export interface Package {
  id: string;
  clientId: string;
  sessions: number;
  purchasedAt: string;
  /** The session it was bought in (its title shows it); unset for one bought on its own. */
  boughtIn?: string;
  note?: string;

  // Copied by the API: never set here.
  /** How many sessions its credits cover. */
  creditsUsed: number;
  /** What its invoice charges. */
  priceCents: number;
  invoice?: DocumentRef;
  receipt?: DocumentRef;
  paid?: Paid;
  version: number;

  // What the API's rules (packages/rules.go) and the book's guards make of
  // it as of the request. Read these; never re-derive them here.
  /** The rules that hold, in priority order. */
  rules: Array<string>;
  /** What is left to do on it now. */
  todo: Array<"collect">;
  /** The actions its to-do rules say resolve them. */
  fixes: Array<string>;
  creditsLeft: number;
  /** Its price while not received. */
  owedCents: number;
  can: PackageCan;
}

/** What each action on a package would say now; mirrors packages.Can. */
export interface PackageCan {
  pay: Verdict;
  undoPayment: Verdict;
  edit: Verdict;
  /** Not while paid, on an issued invoice, or while sessions use its credits. */
  delete: Verdict;
  /** Keep one bought in a session as one of its own. */
  makeStandalone: Verdict;
}

export interface SavePackageInput {
  id?: string;
  clientId: string;
  sessions: number;
  priceCents: number;
  purchasedAt: string;
  note: string;
  /** Paid there and then. */
  paid?: PaymentInput;
  /** Move what was received for it to a new price, on a receipt not issued yet. */
  updatePayment?: boolean;
}

/** Open packages (credits left, or still owed), or every one. */
export type PackagesView = "open" | "all";
