import { scoreFields, searchItems, toFields, tokenize } from "./data-table.search";

describe("table search", () => {
  const rows = [
    { id: "a", fields: toFields(["Jane Smith", "6 Oct 2026", "RM 95.00", ["jane s", "janey"]]) },
    { id: "b", fields: toFields(["Bob Lee", "7 Oct 2026", "RM 200.00", "RCP-0001"]) },
    { id: "c", fields: toFields(["Janet Ong", "6 Nov 2026", "RM 95.00"]) },
    { id: "d", fields: toFields(["José Tan", null, undefined, ""]) },
  ];
  const ids = (query: string) => searchItems(rows, query, (row) => row.fields).map((row) => row.id);

  test("splits the query into words", () => {
    expect(tokenize("  Jane,  OCT ")).toEqual(["jane", "oct"]);
  });

  test("every word must match some column, in any mix", () => {
    expect(ids("jane oct")).toEqual(["a"]);
    expect(ids("95 nov")).toEqual(["c"]);
    expect(ids("jane bob")).toEqual([]);
  });

  test("whole words rank above starts of words", () => {
    // "jane" is a whole word in Jane Smith, only the start of Janet.
    expect(ids("jane")).toEqual(["a", "c"]);
  });

  test("matching inside a word still counts, below the rest", () => {
    expect(ids("anet")).toEqual(["c"]);
  });

  test("equal matches keep the table's order", () => {
    expect(ids("2026")).toEqual(["a", "b", "c"]);
  });

  test("accents and case don't matter", () => {
    expect(ids("jose")).toEqual(["d"]);
    expect(ids("rcp-0001")).toEqual(["b"]);
  });

  test("an empty query keeps every row", () => {
    expect(ids("  ")).toEqual(["a", "b", "c", "d"]);
  });

  test("a word matching no column scores zero", () => {
    expect(scoreFields(["zzz"], toFields(["Jane"]))).toBe(0);
  });
});
