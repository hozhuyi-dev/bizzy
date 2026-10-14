import type { DocumentContent, DocumentLine, DocumentPayment, DocumentSource, Issuer, Recipient } from "./documents.types";
import { centsToInput, parseCents } from "~/core/utils/money.util";

/** The editor works in strings; amounts are typed like "95" or "95.50". */
export interface LineValues {
  /** "" for a line she adds: the API gives it one. */
  id: string;
  description: string;
  date: string;
  amount: string;
  /** Kept as-is: editing a line's text never changes what it covers. */
  source: DocumentSource | undefined;
}

export interface ContentValues {
  date: string;
  issuer: Required<Issuer>;
  recipient: Required<Recipient>;
  lines: Array<LineValues>;
  /** A receipt's payment, as recorded: the payment's to change, not the editor's. */
  payment: DocumentPayment | undefined;
  paidBy: string;
  notes: string;
}

export function toFormValues(content: DocumentContent): ContentValues {
  const { issuer, recipient } = content;
  return {
    date: content.date,
    issuer: {
      name: issuer.name,
      registrationNo: issuer.registrationNo ?? "",
      address: issuer.address ?? "",
      email: issuer.email ?? "",
      phone: issuer.phone ?? "",
      bankName: issuer.bankName ?? "",
      accountName: issuer.accountName ?? "",
      accountNo: issuer.accountNo ?? "",
    },
    recipient: {
      name: recipient.name,
      email: recipient.email ?? "",
      phone: recipient.phone ?? "",
      address: recipient.address ?? "",
    },
    lines: content.lines.map((line) => ({
      id: line.id,
      description: line.description,
      date: line.date ?? "",
      amount: centsToInput(line.amountCents),
      source: line.source,
    })),
    payment: content.payment,
    paidBy: content.paidBy ?? "",
    notes: content.notes ?? "",
  };
}

/** Drops empty optional strings, which the API treats as absent anyway. */
function compact<T extends Record<string, string>>(values: T): Partial<T> {
  return Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim() !== "")) as Partial<T>;
}

export function toContent(values: ContentValues): DocumentContent {
  const lines: Array<DocumentLine> = values.lines.map((line) => ({
    id: line.id,
    description: line.description,
    ...(line.date ? { date: line.date } : {}),
    amountCents: parseCents(line.amount) ?? 0,
    ...(line.source ? { source: line.source } : {}),
  }));

  return {
    date: values.date,
    issuer: { ...compact(values.issuer), name: values.issuer.name },
    recipient: { ...compact(values.recipient), name: values.recipient.name },
    lines,
    ...(values.payment ? { payment: values.payment } : {}),
    ...(values.paidBy.trim() ? { paidBy: values.paidBy } : {}),
    ...(values.notes.trim() ? { notes: values.notes } : {}),
    // The API recomputes this; it is here for the live preview.
    totalCents: lines.reduce((sum, line) => sum + line.amountCents, 0),
  };
}

/** Why the draft can't be saved or issued yet, if anything. */
export function validateContent(values: ContentValues): string | undefined {
  if (!values.recipient.name.trim()) return "Who it's for is required.";
  if (values.lines.some((line) => !line.description.trim())) return "Every line needs a description.";
  if (values.lines.some((line) => parseCents(line.amount) === null)) return "Amounts look like 95 or 95.50.";
  return undefined;
}
