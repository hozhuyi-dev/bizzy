import { COMPUTER_WHATSAPP } from "./whatsapp.constant";
import type { ComputerWhatsApp } from "./whatsapp.constant";
import type { WhatsAppOn } from "./whatsapp.types";

/**
 * The number WhatsApp needs for a Malaysian number as she'd type it
 * ("012-345 6789"): the leading 0 becomes the 60 country code. Undefined
 * when it isn't one.
 */
export function whatsappNumber(phone: string | undefined): string | undefined {
  if (!phone) return undefined;
  let digits = phone.replace(/\D/g, "");
  if (digits.startsWith("0")) digits = `6${digits}`;
  return digits.length < 9 ? undefined : digits;
}

/** A link to the chat, with the message typed in and ready to send when there is text. */
export function whatsappLink(phone: string | undefined, text: string | undefined, on: WhatsAppOn): string | undefined {
  const digits = whatsappNumber(phone);
  if (!digits) return undefined;
  const message = text ? `&text=${encodeURIComponent(text)}` : "";
  switch (on) {
    case "web":
      // Skips the "continue to chat" page wa.me shows on a computer.
      return `https://web.whatsapp.com/send?phone=${digits}${message}`;
    case "desktop":
    case "ios":
      return `whatsapp://send?phone=${digits}${message}`;
    case "app":
      return text ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}` : `https://wa.me/${digits}`;
  }
}

export function isComputerWhatsApp(value: unknown): value is ComputerWhatsApp {
  return COMPUTER_WHATSAPP.includes(value as ComputerWhatsApp);
}
