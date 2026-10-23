import { describe, expect, test, vi } from "vitest";
import { columnIdsOf, fromSorting, sortingFromFilter, toSorting } from "./data-table-sort.util";
import { NO_FILTER } from "~/core/list/filter.util";

const byName = [{ id: "name", desc: false }];
const ids = ["name", "owedCents"];

describe("sorting in the filter", () => {
  test("reads a column and its way, or keeps the list's own", () => {
    expect(toSorting("-owedCents", byName, ids)).toEqual([{ id: "owedCents", desc: true }]);
    expect(toSorting("owedCents", byName, ids)).toEqual([{ id: "owedCents", desc: false }]);
    expect(toSorting(undefined, byName, ids)).toBe(byName);
    // A column the table hasn't got (an old link) is the list's own order.
    expect(toSorting("-gone", byName, ids)).toBe(byName);
  });

  test("writes nothing for the list's own order", () => {
    expect(fromSorting([{ id: "owedCents", desc: true }], byName)).toBe("-owedCents");
    expect(fromSorting(byName, byName)).toBeUndefined();
    expect(fromSorting([], byName)).toBeUndefined();
  });

  test("column ids, by id or the key they read", () => {
    expect(columnIdsOf([{ id: "name" }, { accessorKey: "owedCents" } as { id?: string }, {}])).toEqual(["name", "owedCents"]);
  });

  test("a click keeps the sort in the filter", () => {
    const onFilterChange = vi.fn();
    const options = sortingFromFilter({ ...NO_FILTER, text: "jan" }, onFilterChange, byName, [{ id: "name" }, { id: "owedCents" }]);
    expect(options.state.sorting).toBe(byName);
    options.onSortingChange([{ id: "owedCents", desc: true }]);
    expect(onFilterChange).toHaveBeenCalledWith({ ...NO_FILTER, text: "jan", sort: "-owedCents" });
  });
});
