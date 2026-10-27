import { focusInView } from "~/core/viewport/focus-in-view.util";
import { parseCents } from "~/core/utils/money.util";

/*
 * The checks forms share, so a rule reads and is worded the same wherever it
 * is asked. Each returns what to fix, or undefined when the value is fine;
 * a field's validator calls them with its own value. They check what can be
 * seen in the field alone: a business rule is the API's, which says why
 * when it refuses.
 */

/** A field's validation messages in the shape the form's Field shows. */
export function fieldErrors(errors: ReadonlyArray<unknown>): Array<{ message: string }> {
  return errors.flatMap((error) => (typeof error === "string" && error ? [{ message: error }] : []));
}

/** Something must be filled in: `message` says what. */
export function requiredError(value: string, message: string): string | undefined {
  return value.trim() ? undefined : message;
}

const MONEY_HINT = "An amount, like 95 or 95.50";

/**
 * An amount as typed ("95", "95.50", "RM95"). Blank passes unless
 * `required` says what to ask; `positive` refuses zero.
 */
export function moneyError(
  value: string,
  { required, positive = false }: { required?: string | undefined; positive?: boolean } = {},
): string | undefined {
  if (!value.trim()) return required;
  const cents = parseCents(value);
  if (cents === null) return MONEY_HINT;
  if (positive && cents === 0) return "More than 0";
  return undefined;
}

/** A whole number from min to max, typed (a string) or read from a number input (NaN when empty). */
export function wholeNumberError(value: string | number, min: number, max: number): string | undefined {
  const text = typeof value === "number" ? (Number.isNaN(value) ? "" : String(value)) : value.trim();
  const n = Number(text);
  return /^\d+$/.test(text) && n >= min && n <= max ? undefined : `A whole number from ${min} to ${max}`;
}

// What the browser's email input accepts, about: something@something.something.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** An email address, when one is given. */
export function emailError(value: string): string | undefined {
  return !value.trim() || EMAIL.test(value.trim()) ? undefined : "An email address, like name@example.com";
}

/** The {placeholders} a message template uses that aren't among those it can. */
export function unknownPlaceholders(template: string, known: ReadonlyArray<string>): Array<string> {
  const used = [...template.matchAll(/\{([^{}\s]*)\}/g)].map((match) => match[1] ?? "");
  return [...new Set(used.filter((name) => !known.includes(name)))];
}

/** A template's placeholders, when one isn't known: what it can use instead. */
export function placeholdersError(template: string, known: ReadonlyArray<string>): string | undefined {
  const unknown = unknownPlaceholders(template, known);
  if (unknown.length === 0) return undefined;
  const list = unknown.map((name) => `{${name}}`).join(", ");
  return `${list} ${unknown.length === 1 ? "isn't a placeholder" : "aren't placeholders"}. Use ${known.map((name) => `{${name}}`).join(" ")}.`;
}

/**
 * After a submit that didn't pass: brings the first field with an error into
 * view and puts the cursor in it. In an open dialog when there is one, as the
 * page under it may have fields too. Waits a frame for the errors to show.
 */
export function focusFirstInvalid(): void {
  requestAnimationFrame(() => {
    const root = document.querySelector("[role=dialog], [role=alertdialog]") ?? document;
    const field = root.querySelector<HTMLElement>('[data-slot="field"][data-invalid="true"]');
    if (!field) return;
    field.scrollIntoView({ block: "center", behavior: "smooth" });
    // Over the keyboard it brings up, once that is up.
    const box = field.querySelector<HTMLElement>("input:not([type=hidden]), textarea, button, [tabindex]");
    if (box) focusInView(box);
  });
}
