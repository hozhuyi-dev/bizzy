/**
 * Where WhatsApp opens on a computer: WhatsApp Web in the browser (a new tab
 * per send), or the desktop app. Kept per device like the theme: each
 * computer has its own answer, and her phone always uses the app.
 */
export const COMPUTER_WHATSAPP = ["web", "desktop"] as const;
export type ComputerWhatsApp = (typeof COMPUTER_WHATSAPP)[number];

export const WHATSAPP_STORAGE_KEY = "bizzy.whatsapp";

/** The {placeholders} each message template in Settings can use. */
export const PAYMENT_PLACEHOLDERS = ["firstName", "name", "date", "amount", "bank", "business"] as const;
export const DOCUMENT_PLACEHOLDERS = ["firstName", "name", "title", "documents", "total", "business"] as const;
