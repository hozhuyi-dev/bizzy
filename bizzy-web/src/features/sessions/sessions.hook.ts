import { MessageCircleIcon } from "lucide-react";
import { toast } from "sonner";
import type { SessionView } from "./sessions.types";
import type { Action } from "~/components/shared/action-bar/action-bar.component";
import type { ClientView } from "~/features/clients/clients.types";
import { SettingsQuery } from "~/features/settings/settings.query";
import { useWhatsApp } from "~/features/whatsapp/whatsapp.hook";
import { paymentMessage } from "~/features/whatsapp/whatsapp-message.util";

/**
 * A WhatsApp message to the client (the app on a phone, WhatsApp Web on a
 * computer) asking to pay, with the bank details, while it is unpaid. Its
 * documents are sent from their own pages.
 */
export function useAskToPayAction(session: SessionView, client: ClientView | undefined): Action | undefined {
  const settings = SettingsQuery.useGet();
  const whatsapp = useWhatsApp();

  const due = session.owedCents;
  if (!client || due === 0 || !settings.data) return undefined;
  const text = paymentMessage(settings.data, { clientName: client.name, start: session.start, amountCents: due });
  return {
    type: "button",
    label: "Ask to pay",
    icon: MessageCircleIcon,
    onClick: () => {
      if (!whatsapp.message(client.contact?.phone, text)) toast.error(`${client.name} has no phone number WhatsApp can use.`);
    },
  };
}
