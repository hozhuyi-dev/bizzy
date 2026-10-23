/**
 * Where WhatsApp opens on a computer: WhatsApp Web in the browser (a new tab
 * per send), or the desktop app. Kept per device like the theme: each
 * computer has its own answer, and the user's phone always uses the app.
 */
export const COMPUTER_WHATSAPP = ["web", "desktop"] as const;
export type ComputerWhatsApp = (typeof COMPUTER_WHATSAPP)[number];

export const WHATSAPP_STORAGE_KEY = "bizzy.whatsapp";

/** The {placeholders} each message template in Settings can use. */
export const PAYMENT_PLACEHOLDERS = [
  "firstName",
  "name",
  "items",
  "amount",
  "payLink",
  "bank",
  "phonePay",
  "ref",
  "business",
] as const;
export const DOCUMENT_PLACEHOLDERS = ["firstName", "name", "title", "documents", "total", "business"] as const;

/**
 * The app's wording of the message asking to pay, while the user's own in
 * Settings is blank. A line whose placeholders all come out empty is left
 * out (no e-wallets: no {phonePay} line).
 */
export const DEFAULT_PAYMENT_MESSAGE = `Hi {firstName}, thank you for coming in! 😊

Here are the payment details:
{items}

Pay whichever way is easiest for you:
{payLink}

Or transfer to me directly:
{bank}
{phonePay}
Reference: {ref}

Once done, just send me a screenshot here. Thank you, and take care! 🙏`;

/** The app's wording of the message sending issued documents for the client's records. */
export const DEFAULT_DOCUMENT_MESSAGE = `Hi {firstName}! Here's your {title} for your records 😊

{documents}

Let me know if anything needs changing. Thank you!`;
