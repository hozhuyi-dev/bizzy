import { readComputerWhatsApp } from "./whatsapp.preference";

/**
 * Where a WhatsApp link opens: the app on her phone (a touch screen); on a
 * computer, WhatsApp Web in the browser or the desktop app, as chosen in
 * Settings for that computer.
 */
export type WhatsAppOn = "app" | "web" | "desktop";

export function whatsappOn(): WhatsAppOn {
  return window.matchMedia("(pointer: coarse)").matches ? "app" : readComputerWhatsApp();
}

/**
 * A WhatsApp link for a Malaysian number as she'd type it ("012-345 6789"):
 * the leading 0 becomes the 60 country code. With text, the chat opens with
 * the message typed in, ready to send.
 */
export function whatsappLink(
  phone: string | undefined,
  text?: string,
  on: WhatsAppOn = whatsappOn(),
): string | undefined {
  if (!phone) return undefined;
  let digits = phone.replace(/\D/g, "");
  if (digits.startsWith("0")) digits = `6${digits}`;
  if (digits.length < 9) return undefined;
  const message = text ? `&text=${encodeURIComponent(text)}` : "";
  switch (on) {
    case "web":
      // Skips the "continue to chat" page wa.me shows on a computer.
      return `https://web.whatsapp.com/send?phone=${digits}${message}`;
    case "desktop":
      return `whatsapp://send?phone=${digits}${message}`;
    case "app":
      return text ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}` : `https://wa.me/${digits}`;
  }
}

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
export function openWhatsApp(url: string) {
  if (url.startsWith("whatsapp:")) {
    window.location.href = url;
    return;
  }
  if (!window.open(url, "_blank")) window.location.href = url;
}
