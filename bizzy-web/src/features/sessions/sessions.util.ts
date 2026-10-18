import type { SessionSearch } from "./sessions.types";
import { oneOf, textParam } from "~/core/utils/search.util";

/** The search a session's page takes: where it was opened from, and for what. */
export function validateSessionSearch(search: Record<string, unknown>): SessionSearch {
  return { from: oneOf(search.from, ["home"] as const), settle: textParam(search.settle) };
}
