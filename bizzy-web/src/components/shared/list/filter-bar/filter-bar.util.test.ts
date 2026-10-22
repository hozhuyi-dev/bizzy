import { applySuggestion, chipsOf, removeChip, suggest } from "./filter-bar.util";
import type { Facet, ListFilter } from "~/core/list/filter.types";

const now = new Date(2026, 9, 20, 10);

const facets: Array<Facet> = [
  {
    key: "client",
    label: "Client",
    options: [
      { value: "c1", label: "Jane Smith", keywords: ["Janey"] },
      { value: "c2", label: "Janet Ong" },
      { value: "c3", label: "Octavia Lee" },
    ],
  },
  { key: "todo", label: "Stage", options: [{ value: "collect", label: "Unpaid" }] },
];

const none: ListFilter = { text: "", when: undefined, chips: {} };

const labels = (input: string, filter = none) =>
  suggest(input, filter, facets, true, now).map((group) => [group.label, group.items.map((item) => item.label)]);

describe("suggest", () => {
  test("before typing: a few of each facet, and the presets", () => {
    expect(labels("")).toEqual([
      ["Client", ["Jane Smith", "Janet Ong", "Octavia Lee"]],
      ["Stage", ["Unpaid"]],
      ["Dates", ["This month", "Last month", "This year", "Last year", "Choose days…"]],
    ]);
  });

  test("finds options as the table search finds rows, by name or other names", () => {
    expect(labels("jane")).toEqual([["Client", ["Jane Smith", "Janet Ong"]]]);
    expect(labels("janey")).toEqual([["Client", ["Jane Smith"]]]);
  });

  test("days typed lead the facets", () => {
    expect(labels("oct")).toEqual([
      ["Dates", ["Oct 2026", "Oct 2025", "Choose days…"]],
      ["Client", ["Octavia Lee"]],
    ]);
  });

  test("leaves out what is already chosen", () => {
    const chosen = { ...none, when: "2026-10", chips: { client: ["c1"] } };
    expect(labels("ja", chosen)).toEqual([["Client", ["Janet Ong"]]]);
    expect(labels("this month", chosen)).toEqual([]);
  });
});

describe("chips", () => {
  test("taking a suggestion adds its chip and clears the words", () => {
    const filter = applySuggestion({ ...none, text: "jan" }, { type: "chip", facet: "client", value: "c2", label: "Janet Ong" });
    expect(filter).toEqual({ text: "", when: undefined, chips: { client: ["c2"] } });
    expect(applySuggestion(filter, { type: "when", when: "2026-10", label: "This month" }).when).toBe("2026-10");
  });

  test("a single-choice facet's chip replaces the one before", () => {
    const filter = { ...none, chips: { lapse: ["3"] } };
    expect(applySuggestion(filter, { type: "chip", facet: "lapse", value: "6", label: "6 months", single: true }).chips).toEqual({ lapse: ["6"] });
  });

  test("show in facet order, with their labels", () => {
    const filter = { ...none, chips: { todo: ["collect"], client: ["c1", "gone"] } };
    expect(chipsOf(filter, facets).map((chip) => `${chip.facetLabel}: ${chip.label}`)).toEqual([
      "Client: Jane Smith",
      "Client: gone",
      "Stage: Unpaid",
    ]);
    expect(removeChip(filter, "client", "c1").chips.client).toEqual(["gone"]);
  });
});
