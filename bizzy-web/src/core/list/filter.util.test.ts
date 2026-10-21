import {
  PAGE_SIZE,
  filterSearch,
  formatWhen,
  listRequest,
  parseWhen,
  stepWhen,
  toFilter,
  toSearch,
  whenDays,
  whenParam,
} from "./filter.util";

// A Tuesday in October.
const now = new Date(2026, 9, 20, 10);

describe("when", () => {
  test("is a year, a month, a day or days", () => {
    for (const when of ["2026", "2026-10", "2026-10-05", "2026-10-01~2026-12-31"]) expect(whenParam(when)).toBe(when);
    for (const bad of ["2026-13", "2026-02-30", "2026-12-31~2026-10-01", "oct", 2026, undefined]) {
      expect(whenParam(bad)).toBeUndefined();
    }
  });

  test("spans whole days", () => {
    expect(whenDays("2026")).toEqual({ from: "2026-01-01", to: "2026-12-31" });
    expect(whenDays("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(whenDays("2026-10-05")).toEqual({ from: "2026-10-05", to: "2026-10-05" });
    expect(whenDays("2026-10-01~2026-12-31")).toEqual({ from: "2026-10-01", to: "2026-12-31" });
  });

  test("reads as it is shown", () => {
    expect(formatWhen("2026")).toBe("2026");
    expect(formatWhen("2026-10")).toBe("Oct 2026");
    expect(formatWhen("2026-10-01~2026-12-31")).toBe("1 Oct 2026 – 31 Dec 2026");
  });

  test("steps a year, month or day, but not days picked", () => {
    expect(stepWhen("2026", -1)).toBe("2025");
    expect(stepWhen("2026-01", -1)).toBe("2025-12");
    expect(stepWhen("2026-10-31", 1)).toBe("2026-11-01");
    expect(stepWhen("2026-10-01~2026-12-31", 1)).toBeUndefined();
  });
});

describe("parseWhen", () => {
  const whens = (text: string) => parseWhen(text, now).map((found) => found.when);

  test("presets by name", () => {
    expect(parseWhen("last m", now)).toEqual([{ when: "2026-09", name: "Last month" }]);
    expect(whens("this")).toEqual(["2026-10", "2026"]);
  });

  test("a month alone is this year's, then last year's", () => {
    expect(whens("oct")).toEqual(["2026-10", "2025-10"]);
    expect(whens("December 2024")).toEqual(["2024-12"]);
  });

  test("days and years", () => {
    expect(whens("5 oct")).toEqual(["2026-10-05", "2025-10-05"]);
    expect(whens("oct 5, 2025")).toEqual(["2025-10-05"]);
    expect(whens("2025")).toEqual(["2025"]);
    expect(whens("2026-10-05")).toEqual(["2026-10-05"]);
  });

  test("nothing for words about something else", () => {
    expect(whens("jane")).toEqual([]);
    expect(whens("knee pain")).toEqual([]);
    expect(whens("")).toEqual([]);
  });
});

describe("the URL", () => {
  const facets = ["client", "todo"] as const;

  test("leaves out the defaults, and says all time when the page has a default", () => {
    const filter = { text: " knee ", when: undefined, chips: { client: ["c1"], todo: [] } };
    expect(toSearch(filter, facets, "2026-10")).toEqual({ q: "knee", when: "all", client: ["c1"], todo: undefined });
    expect(toSearch({ ...filter, when: "2026-10" }, facets, "2026-10").when).toBeUndefined();
    expect(toSearch(filter, facets).when).toBeUndefined();
  });

  test("reads back what it wrote, and nothing it doesn't know", () => {
    const search = filterSearch({ q: "knee", when: "all", client: "c1", todo: ["collect", 3], other: "x" }, facets);
    expect(search).toEqual({ q: "knee", when: "all", client: ["c1"], todo: ["collect"] });
    expect(toFilter(search, facets, "2026-10")).toEqual({ text: "knee", when: undefined, chips: { client: ["c1"], todo: ["collect"] } });
    expect(toFilter(filterSearch({}, facets), facets, "2026-10")).toEqual({ text: "", when: "2026-10", chips: {} });
  });

  test("asks the API for the days and the words", () => {
    expect(listRequest({ text: " knee ", when: "2026-10", chips: {} })).toEqual({
      text: "knee",
      from: "2026-10-01",
      to: "2026-10-31",
      limit: PAGE_SIZE,
    });
    expect(listRequest({ text: "", when: undefined, chips: {} })).toEqual({ text: "", limit: PAGE_SIZE });
  });
});
