import { afterEach, describe, expect, test } from "vitest";
import { WhatsAppService } from "./whatsapp.service";

describe("WhatsAppService", () => {
  afterEach(() => localStorage.clear());

  test("opens WhatsApp Web on a computer by default", () => {
    // The test browser has a mouse, not a touch screen.
    expect(WhatsAppService.device()).toBe("web");
    expect(WhatsAppService.link("012-345 6789")).toBe("https://web.whatsapp.com/send?phone=60123456789");
  });

  test("remembers the desktop app when chosen", () => {
    WhatsAppService.setComputerApp("desktop");
    expect(WhatsAppService.device()).toBe("desktop");
    WhatsAppService.setComputerApp("web");
  });
});
