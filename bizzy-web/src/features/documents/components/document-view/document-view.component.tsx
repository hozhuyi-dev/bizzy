import { DOCUMENT_TYPES, documentLabel } from "../../documents.registry";
import type { DocumentContent, DocumentType } from "../../documents.types";
import { formatCents } from "~/core/utils/money.util";
import { formatDate } from "~/core/utils/date.util";

interface DocumentViewProps {
  type: DocumentType;
  content: DocumentContent;
  number?: string | undefined;
  revision?: number | undefined;
  cancelled?: boolean | undefined;
}

/**
 * The document as it prints, on screen: the same blocks as the PDF layout,
 * so the preview while editing is what she will send.
 */
export function DocumentView({ type, content, number, revision, cancelled }: DocumentViewProps) {
  const spec = DOCUMENT_TYPES[type];
  const { issuer, recipient } = content;

  return (
    <div className="relative flex flex-col gap-6 rounded-xl bg-white p-6 text-sm text-neutral-900 shadow-sm ring-1 ring-foreground/10">
      {cancelled && (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-5xl font-bold text-red-600/20 -rotate-12">
          CANCELLED
        </span>
      )}

      <div className="flex flex-wrap justify-between gap-4">
        <div className="flex max-w-xs flex-col">
          <span className="text-base font-semibold">{issuer.name || "Your business name"}</span>
          {issuer.registrationNo && <span className="text-neutral-500">{issuer.registrationNo}</span>}
          {issuer.address && <span className="whitespace-pre-line">{issuer.address}</span>}
          {issuer.phone && <span>{issuer.phone}</span>}
          {issuer.email && <span>{issuer.email}</span>}
        </div>
        <div className="flex flex-col text-right">
          <span className="text-xl font-bold">{spec.title}</span>
          <span>
            <b>No.</b> {documentLabel(number, revision)}
          </span>
          <span>
            <b>Date</b> {content.date ? formatDate(content.date) : "—"}
          </span>
        </div>
      </div>

      <div className="flex flex-col">
        <span className="text-xs text-neutral-500 uppercase">{spec.recipientLabel}</span>
        <span className="font-semibold">{recipient.name}</span>
        {recipient.address && <span className="whitespace-pre-line">{recipient.address}</span>}
        {recipient.phone && <span>{recipient.phone}</span>}
        {recipient.email && <span>{recipient.email}</span>}
      </div>

      <table className="w-full">
        <thead>
          <tr className="border-b border-neutral-900 text-left">
            <th className="py-1 pr-2 font-semibold">Date</th>
            <th className="py-1 pr-2 font-semibold">Description</th>
            <th className="py-1 text-right font-semibold">Amount</th>
          </tr>
        </thead>
        <tbody>
          {content.lines.map((line, i) => (
            <tr key={i} className="border-b border-neutral-200">
              <td className="py-1 pr-2 whitespace-nowrap">{line.date ? formatDate(line.date) : ""}</td>
              <td className="py-1 pr-2">{line.description}</td>
              <td className="py-1 text-right whitespace-nowrap">{formatCents(line.amountCents)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td />
            <td className="pt-2 pr-2 text-right font-semibold">{spec.paid ? "Total paid" : "Total"}</td>
            <td className="pt-2 text-right text-base font-bold whitespace-nowrap">
              {formatCents(content.totalCents)}
            </td>
          </tr>
        </tfoot>
      </table>

      {(content.paidBy || content.notes) && (
        <div className="flex flex-col gap-1">
          {spec.paid && content.paidBy && (
            <span>
              <b>Paid by:</b> {content.paidBy}
            </span>
          )}
          {content.notes && <span className="whitespace-pre-line">{content.notes}</span>}
        </div>
      )}
    </div>
  );
}
