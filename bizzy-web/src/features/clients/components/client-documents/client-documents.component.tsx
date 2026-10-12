import { useState } from "react";
import { CopyIcon, MessageCircleIcon } from "lucide-react";
import type { Client } from "../../clients.types";
import type { DocumentSummary } from "~/features/documents/documents.types";
import { DocumentsQuery } from "~/features/documents/documents.query";
import { DocumentStatusBadge } from "~/features/documents/documents-page.component";
import { DOCUMENT_TYPES, documentLabel } from "~/features/documents/documents.registry";
import { useSendDocuments } from "~/features/whatsapp/use-whatsapp";
import { Loading } from "~/components/shared/quip/quip.component";
import { TextLink } from "~/components/shared/text-link/text-link.component";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { formatCents } from "~/core/utils/money.util";
import { formatDate } from "~/core/utils/date.util";

/**
 * Every document for the client, of any type, newest first. She ticks the
 * issued ones to send and they go in one WhatsApp message, each with its
 * link (the app on her phone, WhatsApp Web on her computer); Copy message
 * gives the same text to paste anywhere.
 */
export function ClientDocuments({ client }: { client: Client }) {
  const docs = DocumentsQuery.useByClient(client.id);
  const { send, copy, busy } = useSendDocuments();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  if (docs.isPending) return <Loading />;
  if (docs.error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {docs.error.message}
      </p>
    );
  }
  if (docs.data.length === 0) {
    return <p className="text-sm text-muted-foreground">No receipts yet. Make one from a paid session.</p>;
  }

  const sendable = docs.data.filter((doc) => doc.status === "issued");
  const chosen = sendable.filter((doc) => selected.has(doc.id));
  const allChosen = sendable.length > 0 && chosen.length === sendable.length;
  const to = { name: client.name, phone: client.contact?.phone };

  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col divide-y text-sm">
        {docs.data.map((doc) => (
          <DocumentRow
            key={doc.id}
            doc={doc}
            selectable={doc.status === "issued"}
            checked={selected.has(doc.id)}
            onCheckedChange={(on) => toggle(doc.id, on)}
          />
        ))}
      </ul>

      {sendable.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelected(allChosen ? new Set() : new Set(sendable.map((doc) => doc.id)))}
          >
            {allChosen ? "Clear" : "Select all"}
          </Button>
          <span className="flex-1 text-sm text-muted-foreground">
            {chosen.length > 0 ? `${chosen.length} selected` : "Tick what to send."}
          </span>
          <Button variant="outline" size="sm" disabled={chosen.length === 0 || busy} onClick={() => copy(to, chosen)}>
            <CopyIcon /> Copy message
          </Button>
          <Button size="sm" disabled={chosen.length === 0 || busy} onClick={() => send(to, chosen)}>
            <MessageCircleIcon /> Send on WhatsApp
          </Button>
        </div>
      )}
    </div>
  );
}

interface DocumentRowProps {
  doc: DocumentSummary;
  /** Only issued documents can be sent; drafts and cancelled are listed. */
  selectable: boolean;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

function DocumentRow({ doc, selectable, checked, onCheckedChange }: DocumentRowProps) {
  const id = `send-${doc.id}`;
  return (
    <li className="flex items-center gap-3 py-2">
      <Checkbox
        id={id}
        aria-label={`Send ${documentLabel(doc.number, doc.revision)}`}
        disabled={!selectable}
        checked={selectable && checked}
        onCheckedChange={onCheckedChange}
      />
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
        <span>
          <span className="text-muted-foreground">{DOCUMENT_TYPES[doc.type].title} </span>
          <TextLink to="/receipts/$id" params={{ id: doc.id }}>
            {documentLabel(doc.number, doc.revision)}
          </TextLink>
          <span className="text-muted-foreground"> · {formatDate(doc.date)}</span>
        </span>
        {doc.status !== "issued" && <DocumentStatusBadge status={doc.status} />}
      </span>
      <span className="whitespace-nowrap">{formatCents(doc.totalCents)}</span>
    </li>
  );
}
