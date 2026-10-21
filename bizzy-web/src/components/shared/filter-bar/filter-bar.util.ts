import type { Facet, ListFilter, When } from "~/core/list/filter.types";
import { searchItems, toFields } from "~/components/shared/data-table/data-table-search.util";
import { formatWhen, parseWhen, presetWhens } from "~/core/list/filter.util";

/** What the dropdown offers: a chip, some days, or picking days. */
export type Suggestion =
  | { type: "chip"; facet: string; value: string; label: string; single?: boolean | undefined }
  | { type: "when"; when: When; label: string; hint?: string | undefined }
  | { type: "days"; label: string };

export interface SuggestionGroup {
  label: string;
  items: Array<Suggestion>;
}

/** A chip as the bar shows it. */
export interface Chip {
  facet: string;
  value: string;
  /** "Client", "Stage". */
  facetLabel: string;
  label: string;
}

// How many of each facet are offered: a few to show what is there before
// anything is typed, more to pick from once it is.
const SHOWN_IDLE = 4;
const SHOWN = 6;

/**
 * What typed text could be filtered by, a group per facet: the options it
 * finds (as the table search finds rows) that aren't chips yet, and the
 * days it could mean. Before anything is typed, the first few of each and
 * the presets, to show what can be filtered by.
 */
export function suggest(
  input: string,
  filter: ListFilter,
  facets: ReadonlyArray<Facet>,
  dates: boolean,
  now = new Date(),
): Array<SuggestionGroup> {
  const typed = input.trim();
  const groups: Array<SuggestionGroup> = [];
  for (const facet of facets) {
    const chosen = filter.chips[facet.key] ?? [];
    const left = facet.options.filter((option) => !chosen.includes(option.value));
    const found = typed ? searchItems(left, typed, (option) => toFields([option.label, option.keywords ?? []])) : left;
    const items = found
      .slice(0, typed ? SHOWN : SHOWN_IDLE)
      .map((option): Suggestion => ({
        type: "chip",
        facet: facet.key,
        value: option.value,
        label: option.label,
        single: facet.single,
      }));
    if (items.length > 0) groups.push({ label: facet.label, items });
  }
  if (!dates) return groups;

  const whens = typed ? parseWhen(typed, now) : presetWhens(now).slice(0, 4);
  const items = whens
    .filter((found) => found.when !== filter.when)
    .map((found): Suggestion => ({
      type: "when",
      when: found.when,
      label: found.name ?? formatWhen(found.when),
      hint: found.name ? formatWhen(found.when) : undefined,
    }));
  if (typed && items.length === 0) return groups;
  items.push({ type: "days", label: "Choose days…" });
  // Days typed lead: "oct" is a month before it is Octavia.
  const days = { label: "Dates", items };
  return typed ? [days, ...groups] : [...groups, days];
}

/** The filter with a suggestion taken: the words that found it are done. */
export function applySuggestion(filter: ListFilter, suggestion: Suggestion): ListFilter {
  switch (suggestion.type) {
    case "chip": {
      const values = suggestion.single ? [] : (filter.chips[suggestion.facet] ?? []);
      return { ...filter, text: "", chips: { ...filter.chips, [suggestion.facet]: [...values, suggestion.value] } };
    }
    case "when":
      return { ...filter, text: "", when: suggestion.when };
    case "days":
      return filter;
  }
}

/** The filter without one chip. */
export function removeChip(filter: ListFilter, facet: string, value: string): ListFilter {
  const values = (filter.chips[facet] ?? []).filter((v) => v !== value);
  return { ...filter, chips: { ...filter.chips, [facet]: values } };
}

/** The filter's chips in the order of the facets, each with its label. */
export function chipsOf(filter: ListFilter, facets: ReadonlyArray<Facet>): Array<Chip> {
  return facets.flatMap((facet) =>
    (filter.chips[facet.key] ?? []).map((value) => ({
      facet: facet.key,
      value,
      facetLabel: facet.label,
      // An option not loaded yet shows its value until it is.
      label: facet.options.find((option) => option.value === value)?.label ?? value,
    })),
  );
}
