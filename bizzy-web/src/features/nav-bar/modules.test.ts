import { describe, expect, test } from "vitest";
import { moduleOf, pageOf } from "./modules";
import { documentLabel } from "~/features/documents/documents.registry";

describe("modules", () => {
  test.each([
    ["/", "Home", "/"],
    ["/sessions", "Sessions", "/sessions"],
    ["/sessions/deleted", "Sessions", "/sessions/deleted"],
    ["/sessions/abc123", "Sessions", "/sessions"],
    ["/clients/reconnect", "Clients", "/clients/reconnect"],
    ["/clients/jane", "Clients", "/clients"],
    ["/packages", "Clients", "/packages"],
    ["/receipts/doc1/", "Documents", "/receipts"],
    ["/settings", "Settings", "/settings"],
  ])("%s is under %s, page %s", (path, label, page) => {
    const module = moduleOf(path);
    expect(module?.label).toBe(label);
    expect(module && pageOf(module, path)?.to).toBe(page);
  });

  test("a path outside every module", () => {
    expect(moduleOf("/d/token")).toBeUndefined();
  });
});

describe("documentLabel", () => {
  test("shows the revision from -00", () => {
    expect(documentLabel("RCP260042", undefined)).toBe("RCP260042-00");
    expect(documentLabel("INV260001", 3)).toBe("INV260001-03");
    expect(documentLabel(undefined, undefined)).toBe("Draft");
  });
});
