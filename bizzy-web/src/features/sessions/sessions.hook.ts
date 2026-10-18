import { MessageCircleIcon, SendIcon } from "lucide-react";
import { toast } from "sonner";
import type { SessionView } from "./sessions.types";
import type { DocumentLink } from "~/features/documents/documents.types";
import type { RowAction } from "~/components/shared/row-actions/row-actions.component";
import type { ClientView } from "~/features/clients/clients.types";
import { DocumentsQuery } from "~/features/documents/documents.query";
import { SettingsQuery } from "~/features/settings/settings.query";
import { useSendDocuments, useWhatsApp } from "~/features/whatsapp/whatsapp.hook";
import { documentsTitle, paymentMessage } from "~/features/whatsapp/whatsapp-message.util";

/**
 * WhatsApp messages to the client (the app on a phone, WhatsApp Web on a
 * computer): asking to pay (with the bank details) while it is unpaid, and
 * sending the issued documents that cover it.
 */
export function useSessionMessageActions(
  session: SessionView,
  client: ClientView | undefined,
  documents: ReadonlyArray<DocumentLink>,
): Array<RowAction> {
  const settings = SettingsQuery.useGet();
  const issuedIds = documents.filter((doc) => doc.issued).map(({ ref }) => ref.id);
  const docs = DocumentsQuery.useByClient(client?.id ?? "", issuedIds.length > 0);
  const { send, busy } = useSendDocuments();
  const whatsapp = useWhatsApp();

  if (!client) return [];
  const to = { name: client.name, phone: client.contact?.phone };
  const actions: Array<RowAction> = [];

  const due = session.owedCents;
  if (due > 0 && settings.data) {
    const text = paymentMessage(settings.data, { clientName: client.name, start: session.start, amountCents: due });
    actions.push({
      label: "Ask to pay",
      icon: MessageCircleIcon,
      onClick: () => {
        if (!whatsapp.message(to.phone, text)) toast.error(`${client.name} has no phone number WhatsApp can use.`);
      },
    });
  }

  const issued = (docs.data ?? []).filter((doc) => doc.status === "issued" && issuedIds.includes(doc.id));
  if (issued.length > 0) {
    actions.push({
      label: `Send ${documentsTitle(issued)}`,
      icon: SendIcon,
      disabled: busy,
      onClick: () => send(to, issued),
    });
  }
  return actions;
}
