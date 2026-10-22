import type { DocumentSummary } from "~/features/documents/documents.types";
import type { SentDocument } from "./whatsapp.types";
import type { SettingsView } from "~/features/settings/settings.types";
import { DOCUMENT_TYPES } from "~/features/documents/documents.constant";
import { documentLabel, shareUrl  } from "~/features/documents/documents.util";
import { formatCents } from "~/core/utils/money.util";
import { formatDate, referenceDay } from "~/core/utils/date.util";
import { PAY_URL } from "~/features/settings/settings.constant";

/**
 * The WhatsApp messages she sends, filled in from her templates in Settings.
 * A {placeholder} the message has no value for is left as typed, so a typo
 * shows up in the chat before she sends it rather than vanishing.
 */

export function fillMessage(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
}

function person(name: string) {
  return { name, firstName: name.trim().split(/\s+/)[0] ?? name };
}

/** Her bank details, one per line, skipping what she hasn't filled in. */
export function bankDetails(settings: SettingsView): string {
  return [settings.bankName, settings.accountName, settings.accountNo].filter(Boolean).join("\n");
}

/** What a payment message asks for: a session, or a package bought on its own. */
export interface PaymentAsk {
  clientName: string;
  /** What it is for, as the message reads it: "your session on 5 Oct 2026". */
  item: string;
  /** Its day: the session's start, or the day the package was bought. */
  date: string;
  amountCents?: number | undefined;
  /** Its invoice's number, once issued. */
  invoiceNumber?: string | undefined;
  /** A package, which the reference says. */
  isPackage?: boolean;
}

/** The most a Malaysian bank app takes as a transfer's reference. */
const REFERENCE_LENGTH = 20;

const referenceText = (text: string) => text.toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * What the client types as the transfer's reference, so the payment is easy
 * to match: its invoice number once issued, else the client's first name
 * and the day ("AISYAH 05OCT", "AISYAH PKG 05OCT" for a package). Letters,
 * digits and spaces only, at most 20, as bank apps take them.
 */
export function paymentReference(ask: Pick<PaymentAsk, "clientName" | "date" | "invoiceNumber" | "isPackage">): string {
  if (ask.invoiceNumber) return referenceText(ask.invoiceNumber).slice(0, REFERENCE_LENGTH);
  const suffix = `${ask.isPackage ? " PKG" : ""} ${referenceDay(ask.date)}`;
  const name = referenceText(person(ask.clientName).firstName).slice(0, REFERENCE_LENGTH - suffix.length);
  return `${name}${suffix}`.trim();
}

/**
 * Asks for payment: the amount, a link to the payment page (every way to
 * pay), her bank details and the reference to give.
 */
export function paymentMessage(settings: SettingsView, ask: PaymentAsk, payUrl: string = PAY_URL): string {
  return fillMessage(settings.paymentMessage, {
    ...person(ask.clientName),
    item: ask.item,
    date: formatDate(ask.date),
    amount: ask.amountCents !== undefined ? formatCents(ask.amountCents) : "",
    payLink: payUrl,
    bank: bankDetails(settings),
    ref: paymentReference(ask),
    business: settings.businessName,
  });
}

/**
 * What {title} reads as: "receipt" for one, "receipts" for several of a
 * kind, "documents" for a mix.
 */
export function documentsTitle(docs: ReadonlyArray<Pick<DocumentSummary, "type">>): string {
  const types = new Set(docs.map((doc) => doc.type));
  const [only] = types;
  if (types.size !== 1 || !only) return "documents";
  const spec = DOCUMENT_TYPES[only];
  return (docs.length === 1 ? spec.title : spec.plural).toLowerCase();
}

/** "Receipt RCP-0001 · 5 Oct 2026 · RM 95.00" and its link on the next line. */
function documentLine(doc: SentDocument): string {
  const label = `${DOCUMENT_TYPES[doc.type].title} ${documentLabel(doc.number, doc.revision)}`;
  const date = doc.date ? ` · ${formatDate(doc.date)}` : "";
  return `${label}${date} · ${formatCents(doc.totalCents)}\n${shareUrl(doc.shareToken)}`;
}

/** Sends links to one or more issued documents, of any types. */
export function documentsMessage(settings: SettingsView, clientName: string, docs: ReadonlyArray<SentDocument>): string {
  return fillMessage(settings.documentMessage, {
    ...person(clientName),
    title: documentsTitle(docs),
    documents: docs.map(documentLine).join("\n\n"),
    total: formatCents(docs.reduce((sum, doc) => sum + doc.totalCents, 0)),
    business: settings.businessName,
  });
}
