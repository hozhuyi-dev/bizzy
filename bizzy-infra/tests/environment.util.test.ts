import { describe, expect, test } from "vitest";
import {
  ENVIRONMENTS,
  resolveEnvironment,
} from "../utils/environment.util";

describe("resolveEnvironment", () => {
  test.each(ENVIRONMENTS)("accepts %s", (environment) => {
    expect(resolveEnvironment(environment)).toBe(environment);
  });

  test("defaults to development when unset", () => {
    expect(resolveEnvironment(undefined)).toBe("development");
  });

  // CI interpolates vars.ENVIRONMENT unconditionally, so an unconfigured
  // repository variable arrives as an empty string rather than undefined.
  test.each(["", "   "])("treats %j as unset", (value) => {
    expect(resolveEnvironment(value)).toBe("development");
  });

  test("trims surrounding whitespace", () => {
    expect(resolveEnvironment(" staging ")).toBe("staging");
  });

  test.each(["stagng", "prod", "Production", "dev"])(
    "rejects %s",
    (value) => {
      expect(() => resolveEnvironment(value)).toThrow(
        /Expected one of: development, staging, production/,
      );
    },
  );

  test("names the offending value", () => {
    expect(() => resolveEnvironment("producton")).toThrow(/"producton"/);
  });
});
