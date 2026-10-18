import { toast } from "sonner";
import { pickQuip } from "./quip.hook";
import type { ExternalToast } from "sonner";
import type { QuipPool } from "~/core/constants/quips.constant";

/**
 * A success toast with a quip under it, for something done that went
 * well. Never for money, errors, or undoing, cancelling and deleting, and
 * never on a toast whose description explains something (see QUIPS).
 */
export function toastWithQuip(message: string, pool: QuipPool, options?: ExternalToast) {
  return toast.success(message, { description: pickQuip(pool), ...options });
}
