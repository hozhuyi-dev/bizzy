import { CheckCheckIcon } from "lucide-react";
import { draftsOf, useDocumentBulkActions } from "../../documents.hook";
import { tickedSummary } from "../../documents.util";
import { DOCUMENT_TYPES } from "../../documents.constant";
import type { DocumentsFor } from "../../documents.hook";
import type { DocumentSummary, DocumentType } from "../../documents.types";
import type { Action } from "~/components/shared/actions/action-bar/action-bar.types";
import { SelectionBar } from "~/components/shared/list/selection-bar/selection-bar.component";

interface TickedBarProps {
  chosen: ReadonlyArray<DocumentSummary>;
  /** Whose they are: what the WhatsApp messages are addressed to. */
  to: DocumentsFor;
  /** Every one shown that can be ticked with them, for Tick all. */
  all: ReadonlyArray<DocumentSummary>;
  /** Ticks exactly these; none clears the ticks. */
  onTick: (docs: ReadonlyArray<DocumentSummary>) => void;
}

const DRAFT_TYPES: ReadonlyArray<DocumentType> = ["invoice", "receipt"];

/**
 * What can be done with ticked documents (one client's), on the selection
 * bar, wherever they are ticked (the documents list, a client's page):
 * WhatsApp first, Put together beside it, and behind ⋯ ticking all of
 * them, or all their draft invoices or receipts to put on one. Rendered
 * only while some are ticked, so what the actions read (the settings the
 * WhatsApp messages are written from) is read only once there are any.
 */
export function TickedBar({ chosen, to, all, onTick }: TickedBarProps) {
  const clear = () => onTick([]);
  const [together, ...whatsapp] = useDocumentBulkActions(chosen, to, clear);
  const whose = to.name ? `${to.name}'s ` : "";
  const tickAll: Array<Action> = [
    ...(all.length > chosen.length
      ? [
          {
            type: "button" as const,
            label: to.name ? `Tick all of ${to.name}'s (${all.length})` : `Tick all (${all.length})`,
            icon: CheckCheckIcon,
            onClick: () => onTick(all),
          },
        ]
      : []),
    // Two or more to put together, unless they are what is ticked already.
    ...DRAFT_TYPES.map((type) => ({ type, drafts: draftsOf(all, type) }))
      .filter(({ drafts }) => drafts.length > 1 && !sameDocuments(drafts, chosen))
      .map(({ type, drafts }) => ({
        type: "button" as const,
        label: `Tick ${whose}draft ${DOCUMENT_TYPES[type].plural.toLowerCase()} (${drafts.length})`,
        icon: CheckCheckIcon,
        onClick: () => onTick(drafts),
      })),
  ];
  return (
    <SelectionBar
      count={chosen.length}
      summary={tickedSummary(chosen, to.name)}
      actions={whatsapp.map((action) => ({ ...action, style: "primary" as const }))}
      more={together ? [together] : []}
      menu={tickAll}
      onClear={clear}
    />
  );
}

function sameDocuments(a: ReadonlyArray<DocumentSummary>, b: ReadonlyArray<DocumentSummary>): boolean {
  return a.length === b.length && a.every((doc) => b.some((other) => other.id === doc.id));
}
