import { describe, expect, test } from "vitest";
import { documentsMessage, documentsTitle, fillMessage, paymentMessage } from "./whatsapp.message";
import type { SentDocument } from "./whatsapp.message";
import type { DocumentType } from "~/features/documents/documents.types";
import type { Settings } from "~/features/settings/settings.types";

const settings: Settings = {
  businessName: "Physio Co",
  registrationNo: "",
  address: "",
  email: "",
  phone: "",
  bankName: "Maybank",
  accountName: "Physio Co",
  accountNo: "1234 5678",
  serviceName: "Physiotherapy session",
  homeVisitColorId: "11",
  numbering: {},
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
  test("uses the first name and her bank details", () => {
    const text = paymentMessage(settings, {
      clientName: "Jane Smith",
      start: "2026-10-05T02:00:00Z",
      amountCents: 9500,
    });
    expect(text).toMatch(/^Hi Jane, 5 Oct 2026: RM\s?95\.00\.\nMaybank\nPhysio Co\n1234 5678$/);
  });

  test("skips bank details she hasn't filled in", () => {
    const text = paymentMessage(
      { ...settings, bankName: "", accountName: "" },
      { clientName: "Jane", start: "2026-10-05T02:00:00Z" },
    );
    expect(text.endsWith(": .\n1234 5678")).toBe(true);
  });
});

describe("documentsMessage", () => {
  test("lists each document with its link", () => {
    const text = documentsMessage(settings, "Jane Smith", [receipt("RCP-0001", 9500), receipt("RCP-0002", 8500)]);
    expect(text).toContain("Hi Jane, your receipts (RM");
    expect(text).toContain("180.00");
    expect(text).toContain("Receipt RCP-0001 · 5 Oct 2026 · ");
    expect(text).toContain("/d/token-RCP-0001");
    expect(text).toContain("/d/token-RCP-0002");
  });

  test("reads {title} from what is sent", () => {
    expect(documentsTitle([{ type: "receipt" }])).toBe("receipt");
    expect(documentsTitle([{ type: "receipt" }, { type: "receipt" }])).toBe("receipts");
    // A type added later mixed with receipts.
    expect(documentsTitle([{ type: "receipt" }, { type: "quotation" as DocumentType }])).toBe("documents");
  });
});
