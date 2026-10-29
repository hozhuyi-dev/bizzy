import type { ChoiceOption } from "~/components/shared/form/form-fields.component";
import type { SessionLocation } from "./sessions.types";

/** What the sessions list can be narrowed by, as its URL names them. */
export const SESSION_FACETS = ["client", "stage", "place", "invoice", "receipt", "payment"] as const;

/** The Stage chip's value for cancelled sessions, beside the to-do reasons. */
export const CANCELLED_STAGE = "cancelled";

/** Where a session is, as lists and the Place chip name it. */
export const SESSION_PLACES: Record<SessionLocation, string> = { visit: "Home visit", own: "Your place" };

/** How long a booking's time must stop changing before the API is asked what would pay for it. */
export const PREVIEW_DEBOUNCE_MS = 400;

/** How a session is paid, as the Paid by buttons say it. */
export const PAY_BY_OPTIONS: ReadonlyArray<ChoiceOption> = [
  { value: "package", label: "Package" },
  { value: "fee", label: "Session fee" },
];
