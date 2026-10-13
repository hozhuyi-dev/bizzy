import { useState } from "react";
import { FileTextIcon, PlusIcon, ReceiptIcon } from "lucide-react";
import { cn } from "cn";
import { allSessionDocuments, documentItems, dueCents, sessionDocuments } from "../../session-stage.util";
import type { PipelineStep } from "../pipeline-layout/pipeline-layout.component";
import type { DocumentItem, Session } from "../../sessions.types";
import type { DocumentType } from "~/features/documents/documents.types";
import type { Package } from "~/features/packages/packages.types";
import { DOCUMENT_TYPES } from "~/features/documents/documents.constant";
import { useCreateDocument } from "~/features/documents/documents.hook";
import { documentLabel, documentRoute } from "~/features/documents/documents.util";
import { TextLink } from "~/components/shared/text-link/text-link.component";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { formatCents } from "~/core/utils/money.util";

export function documentsStep(session: Session, bought: Package | undefined): PipelineStep {
  const docs = allSessionDocuments(session, bought);
  const issued = docs.filter(({ ref }) => ref.number);
  return {
    id: "documents",
    title: "Documents",
    state: issued.length > 0 ? "done" : "optional",
    meta:
      docs.length > 0
        ? docs.map(({ ref }) => documentLabel(ref.number, ref.revision)).join(", ")
        : "Invoice and receipt, if asked",
    content: <DocumentsStep session={session} bought={bought} />,
  };
}

const DOCUMENT_HINTS: Record<DocumentType, string> = {
  invoice: "Once confirmed, with a fee.",
  receipt: "Once paid.",
};

function DocumentsStep({ session, bought }: { session: Session; bought: Package | undefined }) {
  const nothingDue = dueCents(session) === 0 && !bought;

  return (
    <ul className="flex flex-col divide-y text-sm">
      {(["invoice", "receipt"] as const).map((type) => (
        <DocumentRow key={type} type={type} session={session} bought={bought} nothingDue={nothingDue} />
      ))}
    </ul>
  );
}

/**
 * One document type: the ones made, and a new one for what is left. With
 * the fee and a package to cover, she ticks what goes on it; the rest can
 * go on another.
 */
function DocumentRow({
  type,
  session,
  bought,
  nothingDue,
}: {
  type: DocumentType;
  session: Session;
  bought: Package | undefined;
  nothingDue: boolean;
}) {
  const { create, isPending } = useCreateDocument();
  const [picking, setPicking] = useState(false);
  const spec = DOCUMENT_TYPES[type];
  const existing = sessionDocuments(type, session, bought);
  const items = documentItems(type, session, bought);
  const available = items.filter((item) => !item.unavailable);
  const Icon = type === "invoice" ? FileTextIcon : ReceiptIcon;
  const label = existing.length > 0 ? `Another ${spec.title.toLowerCase()}` : `Make ${spec.title.toLowerCase()}`;

  return (
    <li className="flex flex-col gap-2 py-2 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex flex-wrap items-center gap-2">
          <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
          <span className="font-medium">{spec.title}</span>
          {existing.map(({ ref }) => (
            <TextLink key={ref.documentId} to={documentRoute(type)} params={{ id: ref.documentId }}>
              {ref.number ? documentLabel(ref.number, ref.revision) : "Draft"}
            </TextLink>
          ))}
        </span>
        {picking ? null : available.length > 0 ? (
          <Button
            variant="outline"
            size="sm"
            disabled={isPending}
            onClick={() => (items.length > 1 ? setPicking(true) : create(type, available.map((item) => item.source)))}
          >
            <PlusIcon /> {label}
          </Button>
        ) : (
          existing.length === 0 && (
            <span className="text-xs text-muted-foreground">
              {nothingDue ? "Nothing to bill: a package credit covers it." : DOCUMENT_HINTS[type]}
            </span>
          )
        )}
      </div>
      {picking && (
        <DocumentPicker
          items={items}
          submitLabel={label}
          disabled={isPending}
          onSubmit={(sources) => create(type, sources)}
          onCancel={() => setPicking(false)}
        />
      )}
    </li>
  );
}

/** Ticks what a new document covers; what is already on one, or unpaid for a receipt, can't be ticked. */
function DocumentPicker({
  items,
  submitLabel,
  disabled,
  onSubmit,
  onCancel,
}: {
  items: ReadonlyArray<DocumentItem>;
  submitLabel: string;
  disabled: boolean;
  onSubmit: (sources: Array<DocumentItem["source"]>) => void;
  onCancel: () => void;
}) {
  const key = (item: DocumentItem) => `${item.source.kind}:${item.source.id}`;
  const [chosen, setChosen] = useState(() => new Set(items.filter((item) => !item.unavailable).map(key)));
  const selected = items.filter((item) => !item.unavailable && chosen.has(key(item)));
  const total = selected.reduce((sum, item) => sum + item.amountCents, 0);

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3">
      <ul className="flex flex-col gap-2">
        {items.map((item) => {
          const id = `doc-${key(item)}`;
          return (
            <li key={key(item)} className="flex items-center gap-2">
              <Checkbox
                id={id}
                disabled={Boolean(item.unavailable)}
                checked={!item.unavailable && chosen.has(key(item))}
                onCheckedChange={(checked) =>
                  setChosen((current) => {
                    const next = new Set(current);
                    if (checked) next.add(key(item));
                    else next.delete(key(item));
                    return next;
                  })
                }
              />
              <label htmlFor={id} className={cn("flex grow justify-between gap-2", item.unavailable && "text-muted-foreground")}>
                <span>
                  {item.label}
                  {item.unavailable && <span className="text-xs"> · {item.unavailable}</span>}
                </span>
                <span className="tabular-nums">{formatCents(item.amountCents)}</span>
              </label>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={disabled || selected.length === 0} onClick={() => onSubmit(selected.map((item) => item.source))}>
          {submitLabel}
          {selected.length > 0 && <> · {formatCents(total)}</>}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
