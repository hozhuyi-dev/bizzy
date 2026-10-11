import { QUIPS } from "./quips.constant";

describe("quips", () => {
  test.each(Object.entries(QUIPS))("%s has lines to rotate through", (_, pool) => {
    expect(pool.length).toBeGreaterThan(1);
    expect(new Set(pool).size).toBe(pool.length);
  });

  test.each(QUIPS.searchPlaceholder)("“%s” fits the search box", (quip) => {
    expect(quip.length).toBeLessThanOrEqual(24);
  });

  // Read at a glance, and fit on a phone's empty state in one or two lines.
  test.each(Object.values(QUIPS).flat())("“%s” is short", (quip) => {
    expect(quip.length).toBeLessThanOrEqual(45);
  });
});
