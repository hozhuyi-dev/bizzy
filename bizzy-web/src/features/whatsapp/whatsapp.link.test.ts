import { describe, expect, test } from "vitest";
import { whatsappLink } from "./whatsapp.link";

describe("whatsappLink", () => {
  test("turns a local number into the country code", () => {
    expect(whatsappLink("012-345 6789", undefined, "app")).toBe("https://wa.me/60123456789");
    expect(whatsappLink("+60 12 345 6789", undefined, "app")).toBe("https://wa.me/60123456789");
  });

  test("types the message in", () => {
    expect(whatsappLink("012-345 6789", "Hi Jane & co\nThanks", "app")).toBe(
      "https://wa.me/60123456789?text=Hi%20Jane%20%26%20co%0AThanks",
    );
  });

  test("opens WhatsApp Web on a computer", () => {
    // The test browser has a mouse, not a touch screen.
    expect(whatsappLink("012-345 6789")).toBe("https://web.whatsapp.com/send?phone=60123456789");
    expect(whatsappLink("012-345 6789", "Hi & bye", "web")).toBe(
      "https://web.whatsapp.com/send?phone=60123456789&text=Hi%20%26%20bye",
    );
  });

  test("opens the desktop app when chosen", () => {
    expect(whatsappLink("012-345 6789", "Hi & bye", "desktop")).toBe(
      "whatsapp://send?phone=60123456789&text=Hi%20%26%20bye",
    );
  });

  test("ignores what isn't a number", () => {
    expect(whatsappLink("n/a")).toBeUndefined();
    expect(whatsappLink(undefined)).toBeUndefined();
  });
});
