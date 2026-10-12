import { useSyncExternalStore } from "react";

/**
 * Where WhatsApp opens on a computer: WhatsApp Web in the browser (a new tab
 * per send), or the desktop app. Kept per device like the theme: each
 * computer has its own answer, and her phone always uses the app.
 */
export const COMPUTER_WHATSAPP = ["web", "desktop"] as const;
export type ComputerWhatsApp = (typeof COMPUTER_WHATSAPP)[number];

export const WHATSAPP_STORAGE_KEY = "bizzy.whatsapp";

function isComputerWhatsApp(value: unknown): value is ComputerWhatsApp {
  return COMPUTER_WHATSAPP.includes(value as ComputerWhatsApp);
}

// Storage can throw (private mode, blocked site data); then it is WhatsApp
// Web, and a choice lasts for this visit only.
let current: ComputerWhatsApp | null = null;

export function readComputerWhatsApp(): ComputerWhatsApp {
  if (current) return current;
  try {
    const stored = localStorage.getItem(WHATSAPP_STORAGE_KEY);
    current = isComputerWhatsApp(stored) ? stored : "web";
  } catch {
    current = "web";
  }
  return current;
}

const listeners = new Set<() => void>();

export function setComputerWhatsApp(value: ComputerWhatsApp) {
  try {
    localStorage.setItem(WHATSAPP_STORAGE_KEY, value);
  } catch {
    // Still applies for this visit.
  }
  current = value;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
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
}

export function useComputerWhatsApp(): ComputerWhatsApp {
  return useSyncExternalStore(subscribe, readComputerWhatsApp);
}
