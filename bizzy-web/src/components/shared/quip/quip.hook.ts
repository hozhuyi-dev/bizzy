import { useState } from "react";
import type { QuipPool } from "~/core/constants/quips.constant";

/** A line from the pool, at random: for a toast, picked as it shows. */
export function pickQuip(pool: QuipPool): string {
  return pool[Math.floor(Math.random() * pool.length)] ?? "";
}

/**
 * A line from the pool, picked when the component mounts: it stays put while
 * the page re-renders and changes on the next visit. Give a component a key
 * when its pool can change in place.
 */
export function useQuip(pool: QuipPool): string {
  const [quip] = useState(() => pickQuip(pool));
  return quip;
}
