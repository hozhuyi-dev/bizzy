import type { DocumentContent, DocumentLine, DocumentSource, Issuer, Recipient } from "./documents.types";
import { centsToInput, parseCents } from "~/core/utils/money.util";

/** The editor works in strings; amounts are typed like "95" or "95.50". */
export interface LineValues {
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
      description: line.description,
      date: line.date ?? "",
      amount: centsToInput(line.amountCents),
      source: line.source,
    })),
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
    ...(values.paidBy.trim() ? { paidBy: values.paidBy } : {}),
    ...(values.notes.trim() ? { notes: values.notes } : {}),
    // The API recomputes this; it is here for the live preview.
    totalCents: lines.reduce((sum, line) => sum + line.amountCents, 0),
  };
}

/** Why the draft can't be saved or issued yet, if anything. */
export function validateContent(values: ContentValues): string | undefined {
  if (!values.date) return "Choose a date.";
  if (!values.recipient.name.trim()) return "Who it's for is required.";
  if (values.lines.some((line) => !line.description.trim())) return "Every line needs a description.";
  if (values.lines.some((line) => parseCents(line.amount) === null)) return "Amounts look like 95 or 95.50.";
  return undefined;
}
