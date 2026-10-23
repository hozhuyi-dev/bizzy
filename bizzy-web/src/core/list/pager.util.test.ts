import { comesBefore, locate, positionOf, stepFrom } from "./pager.util";
import type { Place, WindowState } from "./pager.types";

// Items are their places; a list reads latest first.
const item = (at: number, id = `i${at}`): Place => ({ at, id });
const list = { idOf: (p: Place) => p.id, placeOf: (p: Place) => p };
const unordered = { idOf: (p: Place) => p.id };
const state = (items: Array<Place>, more: Partial<WindowState<Place>> = {}): WindowState<Place> => ({
  items,
  hasBefore: false,
  hasAfter: false,
  ...more,
});

const top = state([item(50), item(40), item(30)]);

describe("comesBefore", () => {
  test("is the later first, then the larger id, as the API reads", () => {
    expect(comesBefore(item(2), item(1))).toBe(true);
    expect(comesBefore(item(1, "b"), item(1, "a"))).toBe(true);
    expect(comesBefore(item(1, "a"), item(1, "b"))).toBe(false);
    // Undated (a draft) is last.
    expect(comesBefore(item(1), item(-Infinity))).toBe(true);
  });
});

describe("locate", () => {
  test("finds it in the list", () => {
    expect(locate(top, { id: "i40" }, list)).toEqual({ kind: "in", index: 1 });
  });

  test("waits for its place to place it", () => {
    expect(locate(top, { id: "x" }, list)).toEqual({ kind: "loading" });
  });

  test("steps one gone into the list: down from its top, up from its end once read", () => {
    expect(locate(top, { id: "x", gone: true }, list)).toEqual({ kind: "out", prev: 2, next: 0 });
    const more = state(top.items as Array<Place>, { hasAfter: true });
    expect(locate(more, { id: "x", gone: true }, list)).toEqual({ kind: "out", prev: undefined, next: 0 });
    expect(locate(state([]), { id: "x", gone: true }, list)).toEqual({ kind: "out", prev: undefined, next: undefined });
  });

  test("places one not in the list between its neighbours", () => {
    expect(locate(top, { id: "x", place: item(35, "x") }, list)).toEqual({ kind: "out", prev: 1, next: 2 });
    expect(locate(top, { id: "x", place: item(60, "x") }, list)).toEqual({ kind: "out", prev: undefined, next: 0 });
    expect(locate(top, { id: "x", place: item(10, "x") }, list)).toEqual({ kind: "out", prev: 2, next: undefined });
  });

  test("looks further only where it could be", () => {
    const more = state(top.items as Array<Place>, { hasAfter: true });
    // Above the last one read: it would have been read.
    expect(locate(more, { id: "x", place: item(35, "x") }, list)).toEqual({ kind: "out", prev: 1, next: 2 });
    // Below it, or level with it with an id that sorts after: maybe on the next page.
    expect(locate(more, { id: "x", place: item(10, "x") }, list)).toEqual({ kind: "unread", side: "after" });
    expect(locate(more, { id: "a", place: item(30, "a") }, list)).toEqual({ kind: "unread", side: "after" });
    // A window opened partway may have it above.
    const middle = state(top.items as Array<Place>, { hasBefore: true });
    expect(locate(middle, { id: "x", place: item(60, "x") }, list)).toEqual({ kind: "unread", side: "before" });
  });

  test("steps on from where it was once an edit takes it out", () => {
    const seen = { ids: ["i50", "x", "i40", "i30"], index: 1 };
    expect(locate(top, { id: "x" }, list, seen)).toEqual({ kind: "out", prev: 0, next: 1 });
    // Its neighbour went too: the next one still there.
    const after = state([item(50), item(30)]);
    expect(locate(after, { id: "x" }, list, seen)).toEqual({ kind: "out", prev: 0, next: 1 });
  });

  test("without an order, reads to the end, then enters either way", () => {
    expect(locate(state(top.items as Array<Place>, { hasAfter: true }), { id: "x" }, unordered)).toEqual({
      kind: "unread",
      side: "after",
    });
    expect(locate(top, { id: "x" }, unordered)).toEqual({ kind: "out", prev: 2, next: 0 });
    expect(locate(state([]), { id: "x" }, unordered)).toEqual({ kind: "out", prev: undefined, next: undefined });
  });
});

describe("stepFrom", () => {
  test("moves along the list", () => {
    expect(stepFrom({ kind: "in", index: 1 }, "before", top)).toEqual({ to: 0 });
    expect(stepFrom({ kind: "in", index: 1 }, "after", top)).toEqual({ to: 2 });
  });

  test("stops at the ends, or reads past them", () => {
    expect(stepFrom({ kind: "in", index: 0 }, "before", top)).toBeUndefined();
    expect(stepFrom({ kind: "in", index: 2 }, "after", top)).toBeUndefined();
    expect(stepFrom({ kind: "in", index: 2 }, "after", { ...top, hasAfter: true })).toEqual({ read: "after" });
  });

  test("enters the list from outside it", () => {
    expect(stepFrom({ kind: "out", prev: 1, next: 2 }, "before", top)).toEqual({ to: 1 });
    expect(stepFrom({ kind: "out", prev: undefined, next: 0 }, "before", top)).toBeUndefined();
  });

  test("reads where it may be before stepping either way", () => {
    const spot = { kind: "unread", side: "after" } as const;
    expect(stepFrom(spot, "before", top)).toEqual({ read: "after" });
    expect(stepFrom({ kind: "loading" }, "after", top)).toBeUndefined();
  });
});

describe("positionOf", () => {
  test("counts what is loaded, with a + while there is more", () => {
    expect(positionOf({ kind: "in", index: 1 }, top)).toEqual({ at: "2", of: "3" });
    expect(positionOf({ kind: "in", index: 1 }, { ...top, hasAfter: true })).toEqual({ at: "2", of: "3+" });
    expect(positionOf({ kind: "in", index: 1 }, { ...top, hasBefore: true })).toEqual({ at: "?", of: "3+" });
    expect(positionOf({ kind: "out", prev: 0, next: 1 }, top)).toEqual({ at: "–", of: "3" });
    expect(positionOf({ kind: "unread", side: "after" }, top)).toEqual({ at: "…", of: "3" });
    expect(positionOf({ kind: "loading" }, top)).toBeUndefined();
  });
});
