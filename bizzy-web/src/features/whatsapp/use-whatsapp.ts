import { useCallback } from "react";
import { toast } from "sonner";
import { documentsMessage } from "./whatsapp.message";
import { openWhatsApp, whatsappLink, whatsappOn } from "./whatsapp.link";
import type { DocumentSummary } from "~/features/documents/documents.types";
import { DocumentsMutation } from "~/features/documents/documents.query";
import { SettingsQuery } from "~/features/settings/settings.query";

/** An issued document as sending needs it: a summary, or a whole document. */
export type SendableDocument = Pick<
  DocumentSummary,
  "id" | "type" | "number" | "revision" | "date" | "totalCents" | "shareToken"
>;

/**
 * Composes the message with links to issued documents. Documents issued
 * before links existed get one first; everything since has one already.
 */
export function useDocumentsMessage() {
  const settings = SettingsQuery.useGet();
  const share = DocumentsMutation.useShare();
  const { mutateAsync } = share;

  const compose = useCallback(
    async (clientName: string, docs: ReadonlyArray<SendableDocument>): Promise<string> => {
      if (!settings.data) throw new Error("Settings are still loading.");
      const missing = docs.filter((doc) => !doc.shareToken).map((doc) => doc.id);
      const tokens = missing.length > 0 ? await mutateAsync(missing) : {};
      const sent = docs.map((doc) => ({ ...doc, shareToken: doc.shareToken ?? tokens[doc.id] ?? "" }));
      return documentsMessage(settings.data, clientName, sent);
    },
    [settings.data, mutateAsync],
  );

  return { compose, isPending: share.isPending, ready: Boolean(settings.data) };
}

/** Who a message goes to: the client's name, and the phone WhatsApp opens. */
export interface Recipient {
  name: string;
  phone?: string | undefined;
}

/**
 * Opens WhatsApp on the client's chat with links to the documents typed in.
 * Problems (no phone number, a failed request) are shown as toasts.
 */
export function useSendDocuments() {
  const { compose, isPending, ready } = useDocumentsMessage();

  const send = useCallback(
    (to: Recipient, docs: ReadonlyArray<SendableDocument>) => {
      if (!whatsappLink(to.phone)) {
        toast.error(`${to.name} has no phone number WhatsApp can use.`);
        return;
      }
      // WhatsApp Web's tab is opened now, while this is still her click: a
      // tab opened after the request for links would be blocked as a popup.
      const on = whatsappOn();
      const tab = on === "web" ? window.open("", "_blank") : null;
      compose(to.name, docs)
        .then((text) => {
          const url = whatsappLink(to.phone, text, on);
          if (!url) return;
          if (tab) tab.location.href = url;
          else openWhatsApp(url);
        })
        .catch((error: unknown) => {
          tab?.close();
          toast.error(error instanceof Error ? error.message : "Couldn't prepare the message.");
        });
    },
    [compose],
  );

  /** The same message, to paste anywhere (e.g. from a computer). */
  const copy = useCallback(
    (to: Recipient, docs: ReadonlyArray<SendableDocument>) => {
      compose(to.name, docs)
        .then((text) => navigator.clipboard.writeText(text))
        .then(() => toast.success("Message copied"))
        .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Couldn't copy the message."));
    },
    [compose],
  );

  return { send, copy, busy: isPending || !ready };
}
