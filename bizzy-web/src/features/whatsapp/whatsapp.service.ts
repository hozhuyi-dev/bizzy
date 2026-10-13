import { WHATSAPP_STORAGE_KEY } from "./whatsapp.constant";
import { isComputerWhatsApp, whatsappLink } from "./whatsapp.util";
import type { ComputerWhatsApp } from "./whatsapp.constant";
import type { WhatsAppOn } from "./whatsapp.types";

// Storage can throw (private mode, blocked site data); then it is WhatsApp
// Web, and a choice lasts for this visit only.
let current: ComputerWhatsApp | null = null;
const listeners = new Set<() => void>();

export const WhatsAppService = {
  /** Where a link opens on this device: the app on a phone, else her choice for this computer. */
  device(): WhatsAppOn {
    return window.matchMedia("(pointer: coarse)").matches ? "app" : WhatsAppService.getComputerApp();
  },

  /** A link to the chat that opens where this device opens WhatsApp. */
  link(phone: string | undefined, text?: string, on: WhatsAppOn = WhatsAppService.device()): string | undefined {
    return whatsappLink(phone, text, on);
  },

  /**
   * Opens a WhatsApp link. The desktop app's link hands off to the app and
   * leaves the page where it is. Anything else opens in a new tab, or in this
   * one if the browser blocks the tab.
   *
   * WhatsApp Web gets a new tab every send; one tab can't be reused. It sends
   * Cross-Origin-Opener-Policy, which cuts its tab off from the app: the
   * browser clears the tab's name and the app's handle to it, so there is
   * nothing left to send the next chat to. The newest tab takes over WhatsApp
   * Web and the older ones offer "Use here".
   */
  open(url: string): void {
    if (url.startsWith("whatsapp:")) {
      window.location.href = url;
      return;
    }
    if (!window.open(url, "_blank")) window.location.href = url;
  },

  getComputerApp(): ComputerWhatsApp {
    if (current) return current;
    try {
      const stored = localStorage.getItem(WHATSAPP_STORAGE_KEY);
      current = isComputerWhatsApp(stored) ? stored : "web";
    } catch {
      current = "web";
    }
    return current;
  },

  setComputerApp(value: ComputerWhatsApp): void {
    try {
      localStorage.setItem(WHATSAPP_STORAGE_KEY, value);
    } catch {
      // Still applies for this visit.
    }
    current = value;
    listeners.forEach((listener) => listener());
  },

  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    // Another tab changed it.
    const onStorage = (event: StorageEvent) => {
      if (event.key !== WHATSAPP_STORAGE_KEY) return;
      current = null;
      listener();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(listener);
      window.removeEventListener("storage", onStorage);
    };
  },
};
