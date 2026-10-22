import { MessageCircleIcon } from "lucide-react";
import type { SessionView } from "./sessions.types";
import type { Action } from "~/components/shared/actions/action-bar/action-bar.types";
import type { ClientView } from "~/features/clients/clients.types";
import { useAskToPay } from "~/features/whatsapp/whatsapp.hook";
import { formatDate } from "~/core/utils/date.util";

/**
 * A WhatsApp message to the client (the app on a phone, WhatsApp Web on a
 * computer) asking to pay, with the payment page's link and the bank
 * details, while it is unpaid. Its documents are sent from their own pages.
 */
export function useAskToPayAction(session: SessionView, client: ClientView | undefined): Action | undefined {
  const askToPay = useAskToPay();

  const due = session.owedCents;
  if (!client || due === 0 || !askToPay) return undefined;
  return {
    type: "button",
    label: "Ask to pay",
    icon: MessageCircleIcon,
    onClick: () =>
      askToPay(
        { name: client.name, phone: client.contact?.phone },
        {
          item: `your session on ${formatDate(session.start)}`,
          date: session.start,
          amountCents: due,
          invoiceNumber: session.invoice?.number,
        },
      ),
  };
}
