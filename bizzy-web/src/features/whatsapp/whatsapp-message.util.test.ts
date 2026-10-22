import { describe, expect, test } from "vitest";
import { documentsMessage, documentsTitle, fillMessage, paymentMessage, paymentReference } from "./whatsapp-message.util";
import type { SentDocument } from "./whatsapp.types";
import type { DocumentType } from "~/features/documents/documents.types";
import type { SettingsView } from "~/features/settings/settings.types";

const settings: SettingsView = {
  businessName: "Physio Co",
  registrationNo: "",
  address: "",
  email: "",
  phone: "",
  bankName: "Maybank",
  accountName: "Physio Co",
  accountNo: "1234 5678",
  serviceName: "Physiotherapy session",
  confirmAheadDays: 2,
  followUpAheadDays: 7,
  paymentMessage: "Hi {firstName}, {date}: {amount}.\n{bank}",
  documentMessage: "Hi {firstName}, your {title} ({total}):\n{documents}",
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
});

describe("paymentMessage", () => {
  const session = { clientName: "Jane Smith", item: "your session on 5 Oct 2026", date: "2026-10-05T02:00:00Z" };

  test("uses the first name and her bank details", () => {
    const text = paymentMessage(settings, { ...session, amountCents: 9500 });
    expect(text).toMatch(/^Hi Jane, 5 Oct 2026: RM\s?95\.00\.\nMaybank\nPhysio Co\n1234 5678$/);
  });

  test("skips bank details she hasn't filled in", () => {
    const text = paymentMessage({ ...settings, bankName: "", accountName: "" }, { ...session, clientName: "Jane" });
    expect(text.endsWith(": .\n1234 5678")).toBe(true);
  });

  test("links the payment page and gives the reference", () => {
    const text = paymentMessage(
      { ...settings, paymentMessage: "{item}\n{payLink}\nRef: {ref}" },
      session,
      "https://pay.example",
    );
    expect(text).toBe("your session on 5 Oct 2026\nhttps://pay.example\nRef: JANE 05OCT");
  });
});

describe("paymentReference", () => {
  const ask = { clientName: "Aisyah binti Ahmad", date: "2026-10-05" };

  test("names the client and the day until there is an invoice", () => {
    expect(paymentReference(ask)).toBe("AISYAH 05OCT");
    expect(paymentReference({ ...ask, isPackage: true })).toBe("AISYAH PKG 05OCT");
  });

  test("is the invoice's number once issued", () => {
    expect(paymentReference({ ...ask, invoiceNumber: "INV260012" })).toBe("INV260012");
  });

  test("keeps to what bank apps take: letters, digits and spaces, at most 20", () => {
    expect(paymentReference({ ...ask, clientName: "Siti-Nur'aini Abdullah" })).toBe("SITINURAINI 05OCT");
    const long = paymentReference({ ...ask, clientName: "Muhammadabdulrahmanshah Ali", isPackage: true });
    expect(long).toBe("MUHAMMADAB PKG 05OCT");
    expect(long).toHaveLength(20);
    // A name with no Latin letters leaves the day.
    expect(paymentReference({ ...ask, clientName: "陈美玲" })).toBe("05OCT");
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

  test("reads {title} from what is sent", () => {
    expect(documentsTitle([{ type: "receipt" }])).toBe("receipt");
    expect(documentsTitle([{ type: "receipt" }, { type: "receipt" }])).toBe("receipts");
    // A type added later mixed with receipts.
    expect(documentsTitle([{ type: "receipt" }, { type: "quotation" as DocumentType }])).toBe("documents");
  });
});
