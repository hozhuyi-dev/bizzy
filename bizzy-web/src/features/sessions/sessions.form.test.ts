import { describe, expect, test } from "vitest";
import { toSessionFields } from "./sessions.form";
import type { SessionDraft } from "./sessions.types";

const booked: SessionDraft = {
  clientId: "jane",
  start: "2026-10-12T06:00:00Z",
  minutes: 60,
  homeVisit: false,
  tentative: false,
};

describe("toSessionFields — who pays", () => {
  it("sends a payer only when chosen: left alone, the client's usual one bills it", () => {
    expect(toSessionFields(booked)).not.toHaveProperty("billTo");
    expect(toSessionFields({ ...booked, billTo: "mum" })).toMatchObject({ billTo: "mum" });
    const billed = { ...booked, billTo: "mum" };
    expect(toSessionFields(billed, billed)).toEqual({});
    expect(toSessionFields({ ...billed, billTo: "dad" }, billed)).toEqual({ billTo: "dad" });
  });
});

describe("toSessionFields", () => {
  test("a new session sends the booking, and a fee or package only when entered", () => {
    expect(toSessionFields(booked)).toEqual({
      clientId: "jane",
      time: { start: "2026-10-12T06:00:00.000Z", end: "2026-10-12T07:00:00.000Z" },
      location: "own",
      tentative: false,
    });
    expect(toSessionFields({ ...booked, feeCents: 9500, package: { hours: 10, priceCents: 85000 } })).toMatchObject({
      fee: { cents: 9500 },
      package: { bought: { hours: 10, priceCents: 85000 } },
    });
  });

  test("an edit sends only what changed", () => {
    expect(toSessionFields({ ...booked, start: "2026-10-12T06:00:00.000Z" }, booked)).toEqual({});
    expect(toSessionFields({ ...booked, minutes: 90 }, booked)).toEqual({
      time: { start: "2026-10-12T06:00:00.000Z", end: "2026-10-12T07:30:00.000Z" },
    });
    expect(toSessionFields({ ...booked, homeVisit: true, tentative: true }, booked)).toEqual({
      location: "visit",
      tentative: true,
    });
  });

  test("a fee or package taken away is sent empty", () => {
    const priced = { ...booked, feeCents: 9500, package: { hours: 10, priceCents: 85000 } };
    expect(toSessionFields(booked, priced)).toEqual({ fee: {}, package: {} });
    expect(toSessionFields({ ...priced, feeCents: 12000 }, priced)).toEqual({ fee: { cents: 12000 } });
  });
});
