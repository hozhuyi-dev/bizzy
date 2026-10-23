import { DEFAULT_DOCUMENT_MESSAGE, DEFAULT_PAYMENT_MESSAGE } from "./whatsapp.constant";
import type { DocumentAsk, DocumentAskLine, DocumentSummary } from "~/features/documents/documents.types";
import type { SentDocument } from "./whatsapp.types";
import type { SettingsView } from "~/features/settings/settings.types";
import { DOCUMENT_TYPES } from "~/features/documents/documents.constant";
import { documentLabel, shareUrl } from "~/features/documents/documents.util";
import { formatCents } from "~/core/utils/money.util";
import { formatDate } from "~/core/utils/date.util";
import { PAY_APP_OPTIONS, PAY_URL } from "~/features/settings/settings.constant";

/**
 * The two WhatsApp messages the user sends, filled in from their templates
 * in Settings (the app's wording while blank): asking to pay, and issued
 * documents for the client's records. What they list comes from the API.
 */

const PLACEHOLDER = /\{(\w+)\}/g;

/**
 * Fills in the {placeholders}. One the message has no value for is left as
 * typed, so a typo shows up in the chat before it is sent rather than
 * vanishing; a line of only placeholders that all came out empty is left
 * out, and so is a blank line it leaves doubled.
 */
export function fillMessage(template: string, values: Record<string, string>): string {
  const lines = template.split("\n").flatMap((line) => {
    const names = [...line.matchAll(PLACEHOLDER)].map((match) => match[1] ?? "");
    const empty = names.length > 0 && names.every((name) => values[name] === "") && line.replace(PLACEHOLDER, "").trim() === "";
    return empty ? [] : [line.replace(PLACEHOLDER, (match, key: string) => values[key] ?? match)];
  });
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function person(name: string) {
  return { name, firstName: name.trim().split(/\s+/)[0] ?? name };
}

/** The user's bank details, one per line, skipping what isn't filled in. */
export function bankDetails(settings: SettingsView): string {
  return [settings.bankName, settings.accountName, settings.accountNo].filter(Boolean).join("\n");
}

/**
 * The apps that pay the user's phone and its number, as the payment page
 * says them: "DuitNow / TnG eWallet / GrabPay: 012-345 6789"; empty with
 * none. The number is the pay phone, else the business phone.
 */
export function phonePay(settings: SettingsView): string {
  const apps = PAY_APP_OPTIONS.filter((app) => settings.payApps?.includes(app.value)).map((app) => app.label);
  const phone = settings.payPhone || settings.phone;
  return apps.length > 0 && phone ? `${apps.join(" / ")}: ${phone}` : "";
}

/** "Physiotherapy session · 5 Oct 2026 · RM 95.00", or an issued invoice's number, with its link on the next line. */
function askLine(line: DocumentAskLine): string {
  const label = line.number ? `${line.description} ${documentLabel(line.number, line.revision)}` : line.description;
  const date = line.date ? ` · ${formatDate(line.date)}` : "";
  const link = line.shareToken ? `\n${shareUrl(line.shareToken)}` : "";
  return `${label}${date} · ${formatCents(line.amountCents)}${link}`;
}

/** {items}: what is owed, a line each, and the total under several. */
export function askItems(ask: Pick<DocumentAsk, "lines" | "totalCents">): string {
  const lines = ask.lines.map(askLine);
  if (lines.length > 1) lines.push(`Total: ${formatCents(ask.totalCents)}`);
  return lines.join("\n");
}

/**
 * Asks for payment: what is owed, a link to the payment page (every way to
 * pay), the bank details, the phone e-wallets pay, and the reference to give.
 */
export function paymentMessage(settings: SettingsView, clientName: string, ask: DocumentAsk, payUrl: string = PAY_URL): string {
  return fillMessage(settings.paymentMessage || DEFAULT_PAYMENT_MESSAGE, {
    ...person(clientName),
    items: askItems(ask),
    amount: formatCents(ask.totalCents),
    payLink: payUrl,
    bank: bankDetails(settings),
    phonePay: phonePay(settings),
    ref: ask.ref,
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

/** Sends links to one or more issued documents, of any types, for the client's records. */
export function documentsMessage(settings: SettingsView, clientName: string, docs: ReadonlyArray<SentDocument>): string {
  return fillMessage(settings.documentMessage || DEFAULT_DOCUMENT_MESSAGE, {
    ...person(clientName),
    title: documentsTitle(docs),
    documents: docs.map(documentLine).join("\n\n"),
    total: formatCents(docs.reduce((sum, doc) => sum + doc.totalCents, 0)),
    business: settings.businessName,
  });
}

const SAMPLE_CLIENT = "Aisyah binti Ahmad";

/** The message asking to pay as a client would get it for a session, for Settings to preview the template. */
export function paymentPreview(settings: SettingsView): string {
  const line = { description: settings.serviceName, date: "2026-10-05", amountCents: 9500 };
  return paymentMessage(settings, SAMPLE_CLIENT, { clientId: "", lines: [line], totalCents: 9500, ref: "AISYAH 05OCT" });
}

/** The message sending a receipt as a client would get it, for Settings to preview the template. */
export function documentsPreview(settings: SettingsView): string {
  const receipt = { type: "receipt", number: "RCP260001", revision: 0, date: "2026-10-05", totalCents: 9500, shareToken: "sample" } as const;
  return documentsMessage(settings, SAMPLE_CLIENT, [receipt]);
}
