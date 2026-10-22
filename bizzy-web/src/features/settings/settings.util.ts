import type { GoogleConnectionView } from "~/features/google/google.types";

/** "a", "a and b", "a, b and c". */
function and(parts: ReadonlyArray<string>): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

const sentence = (text: string) => (/[.!?]$/.test(text) ? text : `${text}.`);

/**
 * The one line that says what is left to set up: Google first (it reports
 * a problem in its own words; otherwise it is to connect, or a calendar to
 * choose), then the business details that are missing (the API's words:
 * "your SSM number", "your bank details"). `google` is unset while its
 * status loads; nothing left, nothing to say.
 */
export function setupMessage(
  google: { connection: GoogleConnectionView | null } | undefined,
  missing: ReadonlyArray<string>,
): { text: string; problem: boolean } | undefined {
  const connection = google?.connection;
  const details = missing.length > 0 ? `add ${and(missing)}` : undefined;

  if (connection?.problem) {
    const also = details ? ` Also ${details}, for your invoices, receipts and payment messages.` : "";
    return { text: sentence(connection.problem) + also, problem: true };
  }

  const step =
    google === undefined
      ? undefined
      : connection === null
        ? { todo: "connect your Google account", why: ", so bizzy can read your calendar and link clients to your contacts" }
        : !connection?.calendarId
          ? { todo: "choose the calendar you book sessions in", why: ", so bizzy can sync it" }
          : undefined;

  if (step && details) return { text: `Finish setting up: ${step.todo}, and ${details} for your invoices, receipts and payment messages.`, problem: false };
  if (step) return { text: `Finish setting up: ${step.todo}${step.why}.`, problem: false };
  if (details) return { text: `Finish setting up: ${details}, for your invoices, receipts and payment messages.`, problem: false };
  return undefined;
}
