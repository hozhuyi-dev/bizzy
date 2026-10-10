import { CURRENCY, LOCALE } from "~/core/constants/app.constant";

// Amounts travel as integer cents, matching the API, so no float rounding
// ever reaches an invoice total.

const currency = new Intl.NumberFormat(LOCALE, {
  style: "currency",
  currency: CURRENCY,
});

// Same shape the calendar syntax accepts: "95", "95.5", "RM95.50".
const AMOUNT_PATTERN = /^(?:RM\s?)?(\d+)(?:\.(\d{1,2}))?$/i;

export function formatCents(cents: number): string {
  return currency.format(cents / 100);
}

/** Parses a typed amount into cents, or returns null when it isn't one. */
export function parseCents(input: string): number | null {
  const match = AMOUNT_PATTERN.exec(input.trim());
  if (!match) return null;

  const [, whole = "0", fraction = ""] = match;
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

/** Renders cents back into the form an input expects: 9500 → "95". */
export function centsToInput(cents: number | undefined): string {
  if (cents === undefined) return "";
  const whole = Math.trunc(cents / 100);
  const fraction = cents % 100;
  return fraction === 0
    ? String(whole)
    : `${whole}.${String(fraction).padStart(2, "0")}`;
}
