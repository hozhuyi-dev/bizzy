import { errorDetails } from "./error-details.util";
import { ApiError } from "~/core/lambda/lambda.client";

const page = "https://app/sessions/s1";
const at = new Date("2026-10-23T04:05:06.000Z");

describe("errorDetails", () => {
  test("says which call failed and its request, for the Lambda's log", () => {
    const error = new ApiError("internal", "Something went wrong.", [], { action: "sessions.page", requestId: "req-1" });
    expect(errorDetails(error, page, at)).toBe(
      [
        "Error: ApiError: Something went wrong.",
        "Code: internal",
        "Call: sessions.page",
        "Request: req-1",
        `Page: ${page}`,
        "Time: 2026-10-23T04:05:06.000Z",
      ].join("\n"),
    );
  });

  test("keeps what was thrown when the API couldn't be reached", () => {
    const error = new ApiError("unreachable", "Couldn't reach bizzy.", [], { action: "clients.list" }, new TypeError("Failed to fetch"));
    expect(errorDetails(error, page, at)).toContain("Cause: TypeError: Failed to fetch");
  });

  test("has a crash's stack, cut short", () => {
    const error = new TypeError("x is undefined");
    error.stack = ["TypeError: x is undefined", ...Array.from({ length: 20 }, (_, i) => `    at f${i}`)].join("\n");
    const details = errorDetails(error, page, at).split("\n");
    expect(details[0]).toBe("Error: TypeError: x is undefined");
    expect(details).toContain("    at f4");
    expect(details).not.toContain("    at f5");
  });

  test("says what anything else thrown was", () => {
    expect(errorDetails("boom", page, at)).toMatch(/^Error: boom\n/);
  });
});
