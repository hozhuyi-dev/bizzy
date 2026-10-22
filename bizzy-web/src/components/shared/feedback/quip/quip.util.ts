import { toast } from "sonner";
import type { ExternalToast } from "sonner";
import type { QuipPool } from "~/core/constants/quips.constant";

/** A line from the pool, at random: for a toast, picked as it shows. */
export function pickQuip(pool: QuipPool): string {
  return pool[Math.floor(Math.random() * pool.length)] ?? "";
}

/**
 * A success toast with a quip under it, for something done that went
 * well. Never for money, errors, or undoing, cancelling and deleting, and
 * never on a toast whose description explains something (see QUIPS).
 */
export function toastWithQuip(message: string, pool: QuipPool, options?: ExternalToast) {
  return toast.success(message, { description: pickQuip(pool), ...options });
}
