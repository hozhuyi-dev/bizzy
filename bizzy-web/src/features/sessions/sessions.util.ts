import type { SessionSearch } from "./sessions.types";
import { oneOf } from "~/core/utils/search.util";

/** The search a session's page takes: where it was opened from. */
export function validateSessionSearch(search: Record<string, unknown>): SessionSearch {
  return { from: oneOf(search.from, ["home"] as const) };
}
