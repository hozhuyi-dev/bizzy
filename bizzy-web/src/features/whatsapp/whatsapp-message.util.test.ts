import { describe, expect, test } from "vitest";
import { askItems, documentsMessage, documentsTitle, fillMessage, paymentMessage, phonePay } from "./whatsapp-message.util";
import { DEFAULT_DOCUMENT_MESSAGE, DEFAULT_PAYMENT_MESSAGE } from "./whatsapp.constant";
import type { SentDocument } from "./whatsapp.types";
import type { DocumentAsk, DocumentType } from "~/features/documents/documents.types";
import type { SettingsView } from "~/features/settings/settings.types";

const settings: SettingsView = {
  businessName: "Physio Co",
  registrationNo: "",
  address: "",
  email: "",
  phone: "012-345 6789",
  bankName: "Maybank",
  accountName: "Physio Co",
  accountNo: "1234 5678",
  serviceName: "Physiotherapy session",
  confirmAheadDays: 2,
  followUpAheadDays: 7,
  paymentMessage: "Hi {firstName}: {amount}\n{bank}\n{phonePay}\nRef: {ref}",
  documentMessage: "Hi {firstName}, your {title} ({total}):\n{documents}",
};

const ask: DocumentAsk = {
  clientId: "jane",
  lines: [{ description: "Physiotherapy session", date: "2026-10-05", amountCents: 9500 }],
  totalCents: 9500,
  ref: "JANE 05OCT",
};

const receipt = (number: string, totalCents: number): SentDocument => ({
  type: "receipt",
  number,
  date: "2026-10-05",
  totalCents,
  shareToken: `token-${number}`,
});

describe("fillMessage", () => {
  test("fills what it knows and leaves the rest as typed", () => {
    expect(fillMessage("Hi {name}, {nope}", { name: "Jane" })).toBe("Hi Jane, {nope}");
  });

  test("leaves out a line of placeholders that all came out empty, and the blank line it doubles", () => {
    expect(fillMessage("A\n{x}\nB", { x: "" })).toBe("A\nB");
    expect(fillMessage("A\n\n{x} {y}\n\nB", { x: "", y: "" })).toBe("A\n\nB");
    // Not with words of its own, or a placeholder that says something.
    expect(fillMessage("Ref: {x}\n{x}{y}", { x: "", y: "1" })).toBe("Ref: \n1");
  });
});

describe("paymentMessage", () => {
  test("uses the first name, the bank details and the API's reference", () => {
    const text = paymentMessage({ ...settings, phone: "" }, "Jane Smith", ask);
    expect(text).toMatch(/^Hi Jane: RM\s?95\.00\nMaybank\nPhysio Co\n1234 5678\nRef: JANE 05OCT$/);
  });

  test("says which e-wallets pay the phone, only when some do", () => {
    expect(phonePay(settings)).toBe("");
    expect(phonePay({ ...settings, payApps: ["tng", "grabpay"] })).toBe("TnG eWallet / GrabPay: 012-345 6789");
    expect(phonePay({ ...settings, payApps: ["tng"], payPhone: "011-111 1111" })).toBe("TnG eWallet: 011-111 1111");
    const text = paymentMessage({ ...settings, payApps: ["grabpay"] }, "Jane", ask);
    expect(text).toContain("1234 5678\nGrabPay: 012-345 6789\nRef:");
  });

  test("is the app's wording while the user's own is blank", () => {
    const text = paymentMessage({ ...settings, paymentMessage: "" }, "Jane Smith", ask, "https://pay.example");
    expect(text.startsWith("Hi Jane, thank you for coming in!")).toBe(true);
    expect(text).toContain("https://pay.example");
    expect(text).toContain("Reference: JANE 05OCT");
    expect(text).not.toContain("{");
    expect(DEFAULT_PAYMENT_MESSAGE).toContain("{phonePay}");
  });
});

describe("askItems", () => {
  test("lists each thing owed, an issued invoice with its link, and the total under several", () => {
    const text = askItems({
      lines: [
        ...ask.lines,
        { description: "Invoice", number: "INV260012", revision: 0, date: "2026-10-12", amountCents: 19000, shareToken: "tok" },
      ],
      totalCents: 28500,
    });
    const lines = text.split("\n");
    expect(lines[0]).toMatch(/^Physiotherapy session · 5 Oct 2026 · RM\s?95\.00$/);
    expect(lines[1]).toMatch(/^Invoice INV260012-00 · 12 Oct 2026 · RM\s?190\.00$/);
    expect(lines[2]).toContain("/d/tok");
    expect(lines[3]).toMatch(/^Total: RM\s?285\.00$/);
    expect(askItems(ask)).not.toContain("Total");
  });

  test("names whom a line is for when someone else pays", () => {
    const text = askItems({ lines: [{ ...ask.lines[0]!, for: "Adam Tan" }], totalCents: 9500 });
    expect(text).toMatch(/^Physiotherapy session \(Adam\) · 5 Oct 2026 · RM\s?95\.00$/);
  });
});

describe("documentsMessage", () => {
  test("lists each document with its link", () => {
    const text = documentsMessage(settings, "Jane Smith", [receipt("RCP260001", 9500), receipt("RCP260002", 8500)]);
    expect(text).toContain("Hi Jane, your receipts (RM");
    expect(text).toContain("180.00");
    expect(text).toContain("Receipt RCP260001-00 · 5 Oct 2026 · ");
    expect(text).toContain("/d/token-RCP260001");
    expect(text).toContain("/d/token-RCP260002");
  });

  test("is the app's wording while the user's own is blank", () => {
    const text = documentsMessage({ ...settings, documentMessage: "" }, "Jane Smith", [receipt("RCP260001", 9500)]);
    expect(text.startsWith("Hi Jane! Here's your receipt for your records")).toBe(true);
    expect(DEFAULT_DOCUMENT_MESSAGE).toContain("{documents}");
  });

  test("reads {title} from what is sent", () => {
    expect(documentsTitle([{ type: "receipt" }])).toBe("receipt");
    expect(documentsTitle([{ type: "receipt" }, { type: "receipt" }])).toBe("receipts");
    // A type added later mixed with receipts.
    expect(documentsTitle([{ type: "receipt" }, { type: "quotation" as DocumentType }])).toBe("documents");
  });
});
