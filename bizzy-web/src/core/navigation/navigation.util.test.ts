import { describe, expect, test } from "vitest";
import { moduleOf, pageOf } from "./navigation.util";

describe("modules", () => {
  test.each([
    ["/", "Home", "/"],
    ["/sessions", "Sessions", "/sessions"],
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
