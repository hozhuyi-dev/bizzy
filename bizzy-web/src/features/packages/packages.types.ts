import type { DocumentRef } from "~/features/documents/documents.types";
import type { Paid, PaymentInput } from "~/features/payments/payments.types";
import type { Locks, Verdict } from "~/core/lambda/lambda.types";
import type { FilterSearch } from "~/core/list/filter.types";
import type { PACKAGE_FACETS } from "./packages.constant";

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
  /** The other clients whose sessions its credits may pay for. */
  sharedWith: Array<string>;
  /** Hours of its credits each client's sessions use (its own client's too): one with any stays shared. */
  uses: Array<PackageUse>;
  /** Who pays for it: billed by its invoice, or who would be. Asking to pay goes to them. */
  payer: string;
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

/** Hours of a package's credits a client's sessions use; mirrors packages.Use. */
export interface PackageUse {
  clientId: string;
  hours: number;
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
  /** The other clients its credits are for; a new one takes its client's default unless sent. */
  sharedWith?: Array<string>;
  /** Who pays for it; a new one takes its client's default unless sent. */
  billTo?: string;
  /** What was paid for a new one there and then; afterwards a payment is recorded as itself (Mark paid). */
  payment?: PackagePaymentChoice;
  /** Move what was received to a new price, on a receipt not issued yet. */
  updatePayment?: boolean;
}

/** A package's payment as entered, in full; mirrors packages.PaymentChoice. Without one it undoes the payment recorded. */
export interface PackagePaymentChoice {
  payment?: PaymentInput;
}

/**
 * The package a page opens: a new one (for a client, to start with), or
 * one to edit, opened at its payment to pay for it, with the list it steps
 * through.
 */
export type PackageTarget =
  | { mode: "new"; clientId?: string | undefined }
  | { mode: "edit"; pkg: PackageView; at?: "payment" | undefined; search?: PackageSearch | undefined };

/** The packages list's filter, as its URL keeps it; a package's page takes it too. */
export type PackagesSearch = FilterSearch<(typeof PACKAGE_FACETS)[number]>;

/** A package page's search: the list it steps through. Opened from Home, the to-do list's; else the packages list with its filter. */
export interface PackageSearch extends PackagesSearch {
  from?: "home" | undefined;
  /** Opened from a client's timeline (their id): its packages. */
  timeline?: string | undefined;
}
