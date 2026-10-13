import { useCallback, useMemo, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { documentsMessage } from "./whatsapp-message.util";
import { WhatsAppService } from "./whatsapp.service";
import { whatsappNumber } from "./whatsapp.util";
import type { ComputerWhatsApp } from "./whatsapp.constant";
import type { SendableDocument, WhatsAppRecipient } from "./whatsapp.types";
import { DocumentsMutation } from "~/features/documents/documents.mutation";
import { SettingsQuery } from "~/features/settings/settings.query";

/** Where WhatsApp opens on this computer, and a setter that remembers a new choice. */
export function useComputerWhatsApp(): [ComputerWhatsApp, (value: ComputerWhatsApp) => void] {
  const choice = useSyncExternalStore(WhatsAppService.subscribe, WhatsAppService.getComputerApp);
  return [choice, WhatsAppService.setComputerApp];
}

/** Opens a client's chat, with a message typed in, where this device opens WhatsApp. */
export function useWhatsApp() {
  return useMemo(
    () => ({
      /** Whether the phone is a number WhatsApp can use. */
      canMessage: (phone: string | undefined) => whatsappNumber(phone) !== undefined,
      /** Opens the chat; false when the phone isn't a number WhatsApp can use. */
      message: (phone: string | undefined, text?: string): boolean => {
        const url = WhatsAppService.link(phone, text);
        if (url) WhatsAppService.open(url);
        return url !== undefined;
      },
    }),
    [],
  );
}

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

/**
 * Opens WhatsApp on the client's chat with links to the documents typed in.
 * Problems (no phone number, a failed request) are shown as toasts.
 */
export function useSendDocuments() {
  const { compose, isPending, ready } = useDocumentsMessage();

  const send = useCallback(
    (to: WhatsAppRecipient, docs: ReadonlyArray<SendableDocument>) => {
      if (!whatsappNumber(to.phone)) {
        toast.error(`${to.name} has no phone number WhatsApp can use.`);
        return;
      }
      // WhatsApp Web's tab is opened now, while this is still her click: a
      // tab opened after the request for links would be blocked as a popup.
      const on = WhatsAppService.device();
      const tab = on === "web" ? window.open("", "_blank") : null;
      compose(to.name, docs)
        .then((text) => {
          const url = WhatsAppService.link(to.phone, text, on);
          if (!url) return;
          if (tab) tab.location.href = url;
          else WhatsAppService.open(url);
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
    (to: WhatsAppRecipient, docs: ReadonlyArray<SendableDocument>) => {
      compose(to.name, docs)
        .then((text) => navigator.clipboard.writeText(text))
        .then(() => toast.success("Message copied"))
        .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Couldn't copy the message."));
    },
    [compose],
  );

  return { send, copy, busy: isPending || !ready };
}
