// Page views live in the URL, so back and forward return to the same view.
// Defaults are left out of the URL to keep it clean.

/** The value if it is one of the options, else undefined (the default). */
export function oneOf<T extends string>(value: unknown, options: ReadonlyArray<T>): T | undefined {
  return options.find((option) => option === value);
}

/** A "2026-10" month key, else undefined. */
export function monthParam(value: unknown): string | undefined {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? value : undefined;
}

/** A year such as 2026 (from the URL, as text or a number), else undefined. */
export function yearParam(value: unknown): number | undefined {
  const year = Number(value);
  return Number.isInteger(year) && year >= 2000 && year <= 2100 ? year : undefined;
}

/** A non-empty string, else undefined. */
export function textParam(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}
