import { WHATSAPP_STORAGE_KEY } from "./whatsapp.constant";
import { isComputerWhatsApp, whatsappLink } from "./whatsapp.util";
import type { ComputerWhatsApp } from "./whatsapp.constant";
import type { WhatsAppOn } from "./whatsapp.types";

// Storage can throw (private mode, blocked site data); then it is WhatsApp
// Web, and a choice lasts for this visit only.
let current: ComputerWhatsApp | null = null;
const listeners = new Set<() => void>();

/** An iPhone or iPad; iPadOS reports itself as a Mac, but one with a touch screen. */
function isIOS(): boolean {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
}

export const WhatsAppService = {
  /** Where a link opens on this device: the app on a phone, else her choice for this computer. */
  device(): WhatsAppOn {
    if (!window.matchMedia("(pointer: coarse)").matches) return WhatsAppService.getComputerApp();
    return isIOS() ? "ios" : "app";
  },

  /** A link to the chat that opens where this device opens WhatsApp. */
  link(phone: string | undefined, text?: string, on: WhatsAppOn = WhatsAppService.device()): string | undefined {
    return whatsappLink(phone, text, on);
  },

  /**
   * Opens a WhatsApp link. The app's own link (the desktop app, or the app on
   * an iPhone) hands off to the app and leaves the page where it is. Anything
   * else opens in a new tab, or in this one if the browser blocks the tab.
   *
   * An iPhone gets the app's own link rather than wa.me: Chrome there doesn't
   * hand wa.me to the app, so it loads wa.me's page in the new tab, which
   * then opens the app and is left behind.
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
