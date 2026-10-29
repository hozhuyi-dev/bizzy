import { describe, expect, test } from "vitest";
import { toPayFields, toSessionFields } from "./sessions.form";
import type { SessionDraft, SessionView } from "./sessions.types";

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

describe("toSessionFields — how it is paid", () => {
  test("only once chosen, and a fee only for one paid by it", () => {
    expect(toSessionFields(booked)).not.toHaveProperty("pay");
    expect(toSessionFields({ ...booked, payBy: "fee", feeCents: 9500 })).toMatchObject({ pay: { by: "fee" }, fee: { cents: 9500 } });
    const paid = { ...booked, payBy: "package" as const };
    expect(toSessionFields(paid, paid)).toEqual({});
  });
});

describe("toPayFields", () => {
  const session = { pay: { by: "package" }, feeTyped: false, feeCents: 0 } as SessionView;
  const values = { by: "package" as const, packageId: "", fee: "", updatePayment: false };

  test("sends how it is paid, and the package chosen", () => {
    expect(toPayFields(values, session)).toEqual({ pay: { by: "package" } });
    expect(toPayFields({ ...values, packageId: "p2" }, session)).toEqual({ pay: { by: "package", packageId: "p2" } });
  });

  test("paid by its fee: a fee typed, or cleared for the usual one", () => {
    expect(toPayFields({ ...values, by: "fee" }, session)).toEqual({ pay: { by: "fee" } });
    expect(toPayFields({ ...values, by: "fee", fee: "95" }, session)).toEqual({ pay: { by: "fee" }, fee: { cents: 9500 } });
    const typed = { pay: { by: "fee" }, feeTyped: true, feeCents: 9500 } as SessionView;
    expect(toPayFields({ ...values, by: "fee", fee: "95" }, typed)).toEqual({ pay: { by: "fee" } });
    expect(toPayFields({ ...values, by: "fee" }, typed)).toEqual({ pay: { by: "fee" }, fee: {} });
  });
});
