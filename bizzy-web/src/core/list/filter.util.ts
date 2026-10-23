import type { FilterPreset, FilterSearch, ListFilter, ListRequest, Page, When } from "./filter.types";
import { LOCALE } from "~/core/constants/app.constant";
import { addMonths, formatDate, formatMonth, monthKey, toISODate } from "~/core/utils/date.util";
import { textParam } from "~/core/utils/url-param.util";

const YEAR = /^\d{4}$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A real YYYY-MM-DD day ("2026-02-30" isn't). */
function isDay(value: string): boolean {
  if (!DAY.test(value)) return false;
  const [year = 0, month = 1, day = 1] = value.split("-").map(Number);
  return toISODate(new Date(year, month - 1, day)) === value;
}

// A column id, "-" first for descending: "name", "-owedCents".
const SORT = /^-?[A-Za-z][A-Za-z0-9_]*$/;

/** The value as a list's sort, else undefined (the list's own order). */
export function sortParam(value: unknown): string | undefined {
  return typeof value === "string" && SORT.test(value) ? value : undefined;
}

/** No words, days or chips: everything. */
export const NO_FILTER: ListFilter = { text: "", when: undefined, chips: {} };

/** The value as a When, else undefined. */
export function whenParam(value: unknown): When | undefined {
  if (typeof value !== "string") return undefined;
  if (YEAR.test(value) || MONTH.test(value) || isDay(value)) return value;
  const [from, to, extra] = value.split("~");
  if (from && to && extra === undefined && isDay(from) && isDay(to) && from <= to) return value;
  return undefined;
}

/** The first and last day of a When, YYYY-MM-DD. */
export function whenDays(when: When): { from: string; to: string } {
  if (YEAR.test(when)) return { from: `${when}-01-01`, to: `${when}-12-31` };
  if (MONTH.test(when)) {
    const [year = 0, month = 1] = when.split("-").map(Number);
    return { from: `${when}-01`, to: toISODate(new Date(year, month, 0)) };
  }
  const [from = when, to = from] = when.split("~");
  return { from, to };
}

/** "2026", "Oct 2026", "5 Oct 2026", or "1 Oct 2026 – 31 Dec 2026". */
export function formatWhen(when: When): string {
  if (YEAR.test(when)) return when;
  if (MONTH.test(when)) return formatMonth(when);
  const { from, to } = whenDays(when);
  return from === to ? formatDate(from) : `${formatDate(from)} – ${formatDate(to)}`;
}

/** Moves a year, month or day on by n of itself; days picked don't step. */
export function stepWhen(when: When, n: number): When | undefined {
  if (YEAR.test(when)) return String(Number(when) + n);
  if (MONTH.test(when)) return addMonths(when, n);
  if (isDay(when)) {
    const [year = 0, month = 1, day = 1] = when.split("-").map(Number);
    return toISODate(new Date(year, month - 1, day + n));
  }
  return undefined;
}

/** The days a preset name means now, for the presets offered and typed. */
export function presetWhens(now = new Date()): Array<{ name: string; when: When }> {
  const month = monthKey(now);
  const year = now.getFullYear();
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  return [
    { name: "This month", when: month },
    { name: "Last month", when: addMonths(month, -1) },
    { name: "This year", when: String(year) },
    { name: "Last year", when: String(year - 1) },
    { name: "Today", when: toISODate(now) },
    { name: "Yesterday", when: toISODate(yesterday) },
  ];
}

const MONTH_NAMES = Array.from({ length: 12 }, (_, i) => {
  const date = new Date(2000, i, 1);
  return [
    new Intl.DateTimeFormat(LOCALE, { month: "long" }).format(date).toLowerCase(),
    new Intl.DateTimeFormat(LOCALE, { month: "short" }).format(date).toLowerCase(),
  ];
});

/** The month a word names ("oct", "October"), 1–12, from three letters on. */
function monthOf(word: string): number | undefined {
  if (word.length < 3) return undefined;
  const i = MONTH_NAMES.findIndex((names) => names.some((name) => name.startsWith(word)));
  return i < 0 ? undefined : i + 1;
}

/**
 * What typed text could mean as days, most likely first: a preset ("last
 * month"), a year, a month ("oct", "oct 2025"), a day ("5 oct",
 * "2026-10-05"). A month or day without a year is this year's, then last
 * year's. Nothing when the text isn't about days.
 */
export function parseWhen(text: string, now = new Date()): Array<{ when: When; name?: string }> {
  const typed = text.trim().toLowerCase();
  if (!typed) return [];
  const out: Array<{ when: When; name?: string }> = [];
  const add = (when: When | undefined, name?: string) => {
    if (when && whenParam(when) && !out.some((found) => found.when === when)) out.push(name ? { when, name } : { when });
  };

  if (typed.length >= 2) {
    for (const preset of presetWhens(now)) {
      if (preset.name.toLowerCase().startsWith(typed)) add(preset.when, preset.name);
    }
  }
  add(whenParam(typed));

  const words = typed.split(/[\s,./-]+/).filter(Boolean);
  const month = words.map(monthOf).find((m) => m !== undefined);
  const numbers = words.filter((word) => /^\d+$/.test(word)).map(Number);
  const year = numbers.find((n) => n >= 2000 && n <= 2100);
  const day = numbers.find((n) => n >= 1 && n <= 31);
  if (month === undefined || words.length > 3) return out;

  const pad = (n: number) => String(n).padStart(2, "0");
  const years = year ? [year] : [now.getFullYear(), now.getFullYear() - 1];
  for (const y of years) {
    add(day ? `${y}-${pad(month)}-${pad(day)}` : `${y}-${pad(month)}`);
  }
  return out;
}

/** How many items a page asks for: the API's default; it allows up to 200. */
export const PAGE_SIZE = 50;

/** What a search asks the API for: the words, the filter's days (none for all time) and a page's size. */
export function listRequest(filter: ListFilter): ListRequest {
  const request: ListRequest = { text: filter.text.trim(), limit: PAGE_SIZE };
  if (filter.when) Object.assign(request, whenDays(filter.when));
  return request;
}

/** Whether the filter narrows anything besides the days: words or chips. */
export function isNarrowed(filter: ListFilter): boolean {
  return filter.text.trim() !== "" || Object.values(filter.chips).some((values) => values.length > 0);
}

/** Every item of the pages loaded, in order. */
export function pageItems<T>(data: { pages: ReadonlyArray<Page<T>> } | undefined): Array<T> {
  return data?.pages.flatMap((page) => page.items) ?? [];
}

/** A list of values from the URL: one, or several; a number in it parses as one, and is taken as written. */
function listParam(value: unknown): Array<string> | undefined {
  const values = (Array.isArray(value) ? value : [value])
    .map((v) => (typeof v === "number" ? String(v) : v))
    .filter((v): v is string => typeof v === "string" && v !== "");
  return values.length > 0 ? values : undefined;
}

/** A list's filter from its URL: words, days ("all" or a When) and each facet's values. */
export function filterSearch<TKey extends string>(search: Record<string, unknown>, facets: ReadonlyArray<TKey>): FilterSearch<TKey> {
  const out: Record<string, unknown> = {
    q: textParam(search.q),
    when: search.when === "all" ? "all" : whenParam(search.when),
    sort: sortParam(search.sort),
  };
  for (const key of facets) out[key] = listParam(search[key]);
  return out as FilterSearch<TKey>;
}

/** A facet's chips by default, when the URL names none: "status" open. */
export type DefaultChips<TKey extends string> = Partial<Record<TKey, ReadonlyArray<string>>>;

/** In the URL, a facet with chips by default and none chosen: every value. */
const ALL = "all";

/** The filter a URL keeps; without days in it, the page's default days, and the same for each facet's chips. */
export function toFilter<TKey extends string>(
  search: FilterSearch<TKey>,
  facets: ReadonlyArray<TKey>,
  defaultWhen?: When,
  defaultChips: DefaultChips<TKey> = {},
): ListFilter {
  const chips: Record<string, ReadonlyArray<string>> = {};
  for (const key of facets) {
    const values = (search as Partial<Record<TKey, Array<string>>>)[key];
    const fallback = defaultChips[key];
    if (fallback && values?.length === 1 && values[0] === ALL) chips[key] = [];
    else if (values) chips[key] = values;
    else if (fallback) chips[key] = fallback;
  }
  const when = search.when === "all" ? undefined : (search.when ?? defaultWhen);
  return { text: search.q ?? "", when, chips, sort: search.sort };
}

/** The filter as its URL keeps it, leaving out the defaults. */
export function toSearch<TKey extends string>(
  filter: ListFilter,
  facets: ReadonlyArray<TKey>,
  defaultWhen?: When,
  defaultChips: DefaultChips<TKey> = {},
): FilterSearch<TKey> {
  const out: Record<string, unknown> = {
    q: filter.text.trim() || undefined,
    when: filter.when === defaultWhen ? undefined : (filter.when ?? "all"),
    sort: filter.sort,
  };
  for (const key of facets) {
    const values = filter.chips[key] ?? [];
    const fallback = defaultChips[key];
    if (fallback && sameValues(values, fallback)) out[key] = undefined;
    else if (fallback && values.length === 0) out[key] = [ALL];
    else out[key] = values.length > 0 ? [...values] : undefined;
  }
  return out as FilterSearch<TKey>;
}

function sameValues(a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean {
  return a.length === b.length && a.every((value) => b.includes(value));
}

/**
 * The preset the filter is: the same days and chips (the words and the
 * sort aside); undefined for one of her own (Custom).
 */
export function presetOf(filter: ListFilter, presets: ReadonlyArray<FilterPreset>): FilterPreset | undefined {
  return presets.find(
    (preset) =>
      preset.when === filter.when &&
      [...new Set([...Object.keys(preset.chips), ...Object.keys(filter.chips)])].every((key) =>
        sameValues(preset.chips[key] ?? [], filter.chips[key] ?? []),
      ),
  );
}

/** The filter a preset makes, with the words kept; its sort, if it has one, else the list's own. */
export function applyPreset(filter: ListFilter, preset: FilterPreset): ListFilter {
  return { text: filter.text, when: preset.when, chips: preset.chips, sort: preset.sort };
}

/**
 * A list's filter both ways between it and the URL, with the days (and
 * chips) the list shows unless the URL says otherwise. The list's route and its items'
 * routes share it, so an item's page steps through the list it came from.
 */
export function filterUrl<TKey extends string>(
  facets: ReadonlyArray<TKey>,
  defaultWhen?: () => When,
  defaultChips?: DefaultChips<TKey>,
) {
  return {
    validate: (search: Record<string, unknown>): FilterSearch<TKey> => filterSearch(search, facets),
    toFilter: (search: FilterSearch<TKey>): ListFilter => toFilter(search, facets, defaultWhen?.(), defaultChips),
    toSearch: (filter: ListFilter): FilterSearch<TKey> => toSearch(filter, facets, defaultWhen?.(), defaultChips),
  };
}

export type FilterUrl<TKey extends string> = ReturnType<typeof filterUrl<TKey>>;
