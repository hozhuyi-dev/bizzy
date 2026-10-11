import { addMonths, monthRange, monthsBetween, todayISO } from "./date.util";

describe("date utils", () => {
  test("addMonths crosses years", () => {
    expect(addMonths("2026-11", 2)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
  });

  test("monthRange covers the local month", () => {
    const { from, to } = monthRange("2026-10");
    expect(new Date(from).getDate()).toBe(1);
    expect(new Date(to).getMonth()).toBe(10);
  });

  test("monthsBetween counts whole months", () => {
    expect(monthsBetween(new Date(2026, 0, 15), new Date(2026, 3, 14))).toBe(2);
    expect(monthsBetween(new Date(2026, 0, 15), new Date(2026, 3, 15))).toBe(3);
  });

  test("todayISO is local", () => {
    expect(todayISO(new Date(2026, 9, 5, 23, 30))).toBe("2026-10-05");
  });
});
