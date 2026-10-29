import { describe, expect, test } from "vitest";
import { coversText, documentLabel, documentsOfClient } from "./documents.util";
import type { DocumentSummary } from "./documents.types";

describe("coversText", () => {
  test("names one line by its kind, and counts several", () => {
    expect(coversText({ sessions: 1, packages: 0, other: 0, from: "2026-10-05", to: "2026-10-05" })).toBe("Session, 5 Oct");
    expect(coversText({ sessions: 3, packages: 0, other: 0, from: "2026-10-05", to: "2026-10-19" })).toBe("3 sessions, 5–19 Oct");
    expect(coversText({ sessions: 2, packages: 1, other: 1, from: "2026-09-28", to: "2026-10-19" })).toBe(
      // The locale's range: thin spaces around the dash.
      "2 sessions, 1 package, 1 item, 28 Sept – 19 Oct",
    );
  });

  test("leaves the span out when no line has a date", () => {
    expect(coversText({ sessions: 0, packages: 0, other: 2 })).toBe("2 items");
    expect(coversText({ sessions: 0, packages: 0, other: 0 })).toBe("No lines");
  });
});

describe("documentLabel", () => {
  test("shows the revision from -00", () => {
    expect(documentLabel("RCP260042", undefined)).toBe("RCP260042-00");
    expect(documentLabel("INV260001", 3)).toBe("INV260001-03");
    expect(documentLabel(undefined, undefined)).toBe("Draft");
  });
});

describe("documentsOfClient", () => {
  const doc = (id: string, type: DocumentSummary["type"], status: DocumentSummary["status"]) =>
    ({ id, type, status }) as DocumentSummary;
  const docs = [doc("a", "invoice", "issued"), doc("b", "invoice", "cancelled"), doc("c", "receipt", "draft")];
  const ids = (chips: Record<string, Array<string>>) => documentsOfClient(docs, chips).map((d) => d.id);

  test("leaves out the cancelled unless their chip asks for them", () => {
    expect(ids({})).toEqual(["a", "c"]);
    expect(ids({ type: ["invoice"] })).toEqual(["a"]);
    expect(ids({ status: ["cancelled"] })).toEqual(["b"]);
    expect(ids({ status: ["issued", "cancelled"] })).toEqual(["a", "b"]);
  });
});
