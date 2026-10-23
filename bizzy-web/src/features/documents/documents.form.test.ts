import { toContent, toFormValues } from "./documents.form";
import type { DocumentContent } from "./documents.types";

const content: DocumentContent = {
  date: "2026-10-11",
  issuer: { name: "Physio Co", phone: "03-1234 5678" },
  recipient: { name: "Jane Smith" },
  lines: [
    {
      id: "l1",
      description: "Physiotherapy session",
      date: "2026-10-05",
      amountCents: 9550,
      source: { kind: "session", id: "e1" },
    },
  ],
  paidBy: "Cash",
  totalCents: 9550,
};

describe("document form", () => {
  test("round-trips content", () => {
    expect(toContent(toFormValues(content))).toEqual(content);
  });

  test("totals typed amounts and drops empty fields", () => {
    const values = toFormValues(content);
    values.lines.push({ id: "", description: "Taping", date: "", amount: "20", source: undefined });
    values.paidBy = " ";

    const out = toContent(values);
    expect(out.totalCents).toBe(11550);
    expect(out.paidBy).toBeUndefined();
    expect(out.lines[1]).toEqual({ id: "", description: "Taping", amountCents: 2000 });
  });
});
