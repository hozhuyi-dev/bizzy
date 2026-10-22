import { describe, expect, test } from "vitest";
import { documentLabel } from "./documents.util";

describe("documentLabel", () => {
  test("shows the revision from -00", () => {
    expect(documentLabel("RCP260042", undefined)).toBe("RCP260042-00");
    expect(documentLabel("INV260001", 3)).toBe("INV260001-03");
    expect(documentLabel(undefined, undefined)).toBe("Draft");
  });
});
