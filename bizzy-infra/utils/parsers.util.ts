/**
 * Parses an env var string into a string array.
 * Accepts: "a,b,c" or "[ a, b, c ]"
 */
export function parseEnvList(value: string | undefined): Array<string> {
  if (!value) return [];

  const trimmed = value.trim();

  const inner =
    trimmed.startsWith("[") && trimmed.endsWith("]")
      ? trimmed.slice(1, -1)
      : trimmed;

  return inner
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
