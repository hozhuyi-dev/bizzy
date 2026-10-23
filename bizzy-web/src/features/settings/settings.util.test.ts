import { describe, expect, test } from "vitest";
import { setupMessage } from "./settings.util";
import type { GoogleConnectionView } from "~/features/google/google.types";

const connected: GoogleConnectionView = {
  email: "physio@example.com",
  calendarId: "cal1",
  calendarName: "Sessions",
  connectedAt: "2026-10-01T00:00:00Z",
};

describe("setupMessage", () => {
  test("nothing left: nothing to say", () => {
    expect(setupMessage({ connection: connected }, [])).toBeUndefined();
  });

  test("Google alone", () => {
    expect(setupMessage({ connection: null }, [])?.text).toBe(
      "Finish setting up: connect your Google account, so bizzy can read your calendar and link clients to your contacts.",
    );
    expect(setupMessage({ connection: { ...connected, calendarId: "" } }, [])?.text).toBe(
      "Finish setting up: choose the calendar you book sessions in, so bizzy can sync it.",
    );
  });

  test("the business details, alone", () => {
    expect(setupMessage({ connection: connected }, ["your SSM number", "your bank details"])).toEqual({
      text: "Finish setting up: add your SSM number and your bank details, for your invoices, receipts and payment messages.",
      problem: false,
    });
  });

  test("both, in one line", () => {
    expect(setupMessage({ connection: null }, ["your business name", "your email", "your bank details"])?.text).toBe(
      "Finish setting up: connect your Google account, and add your business name, your email and your bank details for your invoices, receipts and payment messages.",
    );
  });

  test("a problem with Google leads, in its own words", () => {
    expect(setupMessage({ connection: { ...connected, problem: "Google no longer accepts the connection" } }, ["your email"])).toEqual({
      text: "Google no longer accepts the connection. Also add your email, for your invoices, receipts and payment messages.",
      problem: true,
    });
  });

  test("while Google's status loads, only the details", () => {
    expect(setupMessage(undefined, [])).toBeUndefined();
    expect(setupMessage(undefined, ["your email"])?.text).toBe(
      "Finish setting up: add your email, for your invoices, receipts and payment messages.",
    );
  });
});
