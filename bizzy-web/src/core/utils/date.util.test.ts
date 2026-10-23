import { addDays, addMonths, dayRange, formatHours, monthRange, monthsBetween, startOfDay, toISODate, todayISO } from "./date.util";

describe("date utils", () => {
  test("formatHours writes half hours", () => {
    expect(formatHours(1.5)).toBe("1.5 h");
    expect(formatHours(10)).toBe("10 h");
  });

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

  test("addDays crosses months", () => {
    expect(toISODate(addDays(new Date(2026, 9, 30), 3))).toBe("2026-11-02");
    expect(toISODate(addDays(new Date(2026, 9, 1), -1))).toBe("2026-09-30");
  });

  test("dayRange covers the local day", () => {
    const { from, to } = dayRange(new Date(2026, 9, 5, 15, 45));
    expect(new Date(from)).toEqual(startOfDay(new Date(2026, 9, 5)));
    expect(new Date(to)).toEqual(new Date(2026, 9, 6));
  });
});
