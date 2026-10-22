import { LOCALE } from "~/core/constants/app.constant";

// Dates travel as RFC 3339 instants (sessions) or YYYY-MM-DD (documents).
// Both are shown in the browser's time zone, which is hers.

const dateFormat = new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "short", year: "numeric" });
const dayFormat = new Intl.DateTimeFormat(LOCALE, { weekday: "short", day: "numeric", month: "short" });
const timeFormat = new Intl.DateTimeFormat(LOCALE, { hour: "numeric", minute: "2-digit" });
const monthFormat = new Intl.DateTimeFormat(LOCALE, { month: "short", year: "numeric" });

/** "5 Oct 2026" from an instant or a YYYY-MM-DD date. */
export function formatDate(value: string): string {
  return dateFormat.format(parseDay(value));
}

/** "Mon, 5 Oct · 10:00 am" for a session start. */
export function formatSessionTime(value: string): string {
  const date = new Date(value);
  return `${dayFormat.format(date)} · ${timeFormat.format(date)}`;
}

/** "1.5 h" from hours, as charged and credited: by the half hour. */
export function formatHours(hours: number): string {
  return `${hours.toLocaleString(LOCALE, { maximumFractionDigits: 2 })} h`;
}

/** "Oct 2026" from a "2026-10" month key. */
export function formatMonth(month: string): string {
  const [year = 0, mon = 1] = month.split("-").map(Number);
  return monthFormat.format(new Date(year, mon - 1, 1));
}

/** YYYY-MM-DD dates are calendar days, not instants: read them as local. */
const MONTH_CODES = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** "05OCT" from an instant or a YYYY-MM-DD date: a day as a bank transfer's reference takes it. */
export function referenceDay(value: string): string {
  const date = parseDay(value);
  return `${String(date.getDate()).padStart(2, "0")}${MONTH_CODES[date.getMonth()]}`;
}

function parseDay(value: string): Date {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (day) return new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]));
  return new Date(value);
}

/** Today as YYYY-MM-DD in local time. */
export function todayISO(now = new Date()): string {
  return toISODate(now);
}

export function toISODate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Midnight at the start of the local day. */
export function startOfDay(date = new Date()): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** The date n local days on (or back, for negative n). */
export function addDays(date: Date, n: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + n);
  return next;
}

/** The local day as [start, end) instants, for range queries. */
export function dayRange(date = new Date()): { from: string; to: string } {
  const start = startOfDay(date);
  return { from: start.toISOString(), to: addDays(start, 1).toISOString() };
}

/** "09:30" for a local time, as a time input takes it. */
export function toTimeInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** "2026-10" for a local date. */
export function monthKey(date: Date): string {
  return toISODate(date).slice(0, 7);
}

/** The local month as [start, end) instants, for range queries. */
export function monthRange(month: string): { from: string; to: string } {
  const [year = 0, mon = 1] = month.split("-").map(Number);
  return {
    from: new Date(year, mon - 1, 1).toISOString(),
    to: new Date(year, mon, 1).toISOString(),
  };
}

/** Moves a "2026-10" month key by n months. */
export function addMonths(month: string, n: number): string {
  const [year = 0, mon = 1] = month.split("-").map(Number);
  return monthKey(new Date(year, mon - 1 + n, 1));
}

/** Whole months between two dates, rounded down. */
export function monthsBetween(from: Date, to: Date): number {
  let months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
  if (to.getDate() < from.getDate()) months--;
  return Math.max(months, 0);
}

const relativeFormat = new Intl.RelativeTimeFormat(LOCALE, { numeric: "auto" });

/** "5 minutes ago", "yesterday". */
export function formatRelative(value: string, now = new Date()): string {
  const seconds = (new Date(value).getTime() - now.getTime()) / 1000;
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return relativeFormat.format(Math.round(seconds / size), unit);
  }
  return "just now";
}
