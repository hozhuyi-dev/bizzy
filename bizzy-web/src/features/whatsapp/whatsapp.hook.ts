import { useCallback, useMemo, useSyncExternalStore } from "react";
import { FileTextIcon, HandCoinsIcon, MessageCircleIcon } from "lucide-react";
import { documentsMessage, paymentMessage } from "./whatsapp-message.util";
import { WhatsAppService } from "./whatsapp.service";
import { whatsappNumber } from "./whatsapp.util";
import type { ComputerWhatsApp } from "./whatsapp.constant";
import type { SendableDocument, WhatsAppRecipient } from "./whatsapp.types";
import type { Action, MenuItemAction } from "~/components/shared/actions/action-bar/action-bar.types";
import type { AskDocumentsRequest, DocumentSource } from "~/features/documents/documents.types";
import type { Verdict } from "~/core/lambda/lambda.types";
import { DocumentsMutation } from "~/features/documents/documents.mutation";
import { DocumentsService } from "~/features/documents/documents.service";
import { SettingsQuery } from "~/features/settings/settings.query";
import { toastRefusal } from "~/features/remedies/components/remedy-buttons/remedy-buttons.component";

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
function useDocumentsMessage() {
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

  return { compose, busy: share.isPending || !settings.data };
}

/**
 * Opens the client's chat with a message composed from the API's answer.
 * WhatsApp Web's tab is opened now, while this is still the user's click:
 * a tab opened after the request would be blocked as a popup. A refusal
 * shows as a toast, with its remedies.
 */
function openWith(to: WhatsAppRecipient, compose: () => Promise<string>): void {
  const on = WhatsAppService.device();
  const tab = on === "web" ? window.open("", "_blank") : null;
  compose()
    .then((text) => {
      const url = WhatsAppService.link(to.phone, text, on);
      if (!url) tab?.close();
      else if (tab) tab.location.href = url;
      else WhatsAppService.open(url);
    })
    .catch((error: unknown) => {
      tab?.close();
      toastRefusal(error);
    });
}

/** Why a chat can't be opened: no number WhatsApp can use. */
function phoneless(to: WhatsAppRecipient): Verdict | undefined {
  return whatsappNumber(to.phone) ? undefined : { ok: false, why: `${to.name} has no phone number WhatsApp can use.` };
}

/** "Mum" of "Mum Tan": what a menu calls someone. */
function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

/** What a WhatsApp menu offers for something; a way it leaves out isn't offered. */
export interface WhatsAppTarget {
  /** Who pays for it: asked to pay, and sent its documents. */
  to: WhatsAppRecipient;
  /** Whom it is for, when that isn't who pays (Mum pays for Adam's session): Open chat offers their chat too. */
  about?: WhatsAppRecipient | undefined;
  /** Asking to pay for items and invoices, as its view's verdict says. */
  askToPay?: { request: AskDocumentsRequest; can: Verdict } | undefined;
  /** Sending issued documents for the client's records: these, or those covering items, as its view's verdict says. */
  sendRecords?:
    | { docs: ReadonlyArray<SendableDocument>; can: Verdict }
    | { items: Array<DocumentSource>; can: Verdict }
    | undefined;
  /** Opening the chat with nothing typed in. */
  openChat?: boolean | undefined;
}

/**
 * Makes the WhatsApp menu (WhatsApp ▾) for something: ask to pay, send
 * for records, open the chat, each as its verdict says, and none without
 * a phone number WhatsApp can use. A message opens typed in, ready to send.
 */
export function useWhatsAppMenu(): (target: WhatsAppTarget) => Action {
  const settings = SettingsQuery.useGet().data;
  const records = useDocumentsMessage();
  const { compose } = records;
  const busy = records.busy || !settings;

  return useCallback(
    ({ to, about, askToPay, sendRecords, openChat }: WhatsAppTarget): Action => {
      const noPhone = phoneless(to);
      // Someone else pays: each way says whose chat it opens.
      const other = about && about.name !== to.name ? about : undefined;
      const payer = firstName(to.name);
      const actions: Array<MenuItemAction> = [];
      if (askToPay) {
        actions.push({
          type: "button",
          label: other ? `Ask ${payer} to pay` : "Ask to pay",
          icon: HandCoinsIcon,
          can: noPhone ?? askToPay.can,
          disabled: busy,
          onClick: () =>
            openWith(to, async () => {
              const ask = await DocumentsService.ask(askToPay.request);
              if (!settings) throw new Error("Settings are still loading.");
              return paymentMessage(settings, to.name, ask);
            }),
        });
      }
      if (sendRecords) {
        actions.push({
          type: "button",
          label: other ? `Send records to ${payer}` : "Send for records",
          icon: FileTextIcon,
          can: noPhone ?? sendRecords.can,
          disabled: busy,
          onClick: () =>
            openWith(to, async () =>
              compose(to.name, "docs" in sendRecords ? sendRecords.docs : await DocumentsService.records(sendRecords.items)),
            ),
        });
      }
      if (openChat) {
        for (const chat of other ? [other, to] : [to]) {
          actions.push({
            type: "button",
            label: other ? `Open chat with ${firstName(chat.name)}` : "Open chat",
            icon: MessageCircleIcon,
            can: phoneless(chat),
            onClick: () => openWith(chat, () => Promise.resolve("")),
          });
        }
      }
      return { type: "menu", label: "WhatsApp", icon: MessageCircleIcon, actions };
    },
    [settings, compose, busy],
  );
}
