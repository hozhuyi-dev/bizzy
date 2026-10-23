import { useState } from "react";
import { pickQuip } from "./quip.util";
import type { QuipPool } from "~/core/constants/quips.constant";

/**
 * A line from the pool, picked when the component mounts: it stays put while
 * the page re-renders and changes on the next visit. Give a component a key
 * when its pool can change in place.
 */
export function useQuip(pool: QuipPool): string {
  const [quip] = useState(() => pickQuip(pool));
  return quip;
}
