// Page views live in the URL, so back and forward return to the same view.
// Defaults are left out of the URL to keep it clean.

/** The value if it is one of the options, else undefined (the default). */
export function oneOf<T extends string>(value: unknown, options: ReadonlyArray<T>): T | undefined {
  return options.find((option) => option === value);
}

/** A non-empty string, else undefined. */
export function textParam(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}
