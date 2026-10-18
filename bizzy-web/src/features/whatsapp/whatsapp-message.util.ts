import type { DocumentSummary } from "~/features/documents/documents.types";
import type { SentDocument } from "./whatsapp.types";
import type { SettingsView } from "~/features/settings/settings.types";
import { DOCUMENT_TYPES } from "~/features/documents/documents.constant";
import { documentLabel, shareUrl  } from "~/features/documents/documents.util";
import { formatCents } from "~/core/utils/money.util";
import { formatDate } from "~/core/utils/date.util";

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

/** Asks for payment for a session, with her bank details. */
export function paymentMessage(
  settings: SettingsView,
  session: { clientName: string; start: string; amountCents?: number | undefined },
): string {
  return fillMessage(settings.paymentMessage, {
    ...person(session.clientName),
    date: formatDate(session.start),
    amount: session.amountCents !== undefined ? formatCents(session.amountCents) : "",
    bank: bankDetails(settings),
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
  return `${label} · ${formatDate(doc.date)} · ${formatCents(doc.totalCents)}\n${shareUrl(doc.shareToken)}`;
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
