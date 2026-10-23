import { BeeArt } from "~/components/shared/feedback/bee-art/bee-art.component";
import { EmptyStateFrame } from "~/components/shared/feedback/empty-state/empty-state.component";
import { FallbackState } from "~/components/shared/feedback/fallback-state/fallback-state.component";
import { useQuip } from "~/components/shared/feedback/quip/quip.hook";
import { QUIPS } from "~/core/constants/quips.constant";

/**
 * `page`: a whole page's body (its header is the page's own), centred like
 * the not-found page and an error, so one gives way to the other in place.
 * `section`: a part of a page, a dialog, a table's one row, shaped like
 * its empty state (EmptyStateFrame), so what comes grows into place.
 */
export type LoadingShape = "section" | "page";

/**
 * Stands in for "Loading…": a drawing, hovering, by a quip. Shown only
 * after --wait-delay, so a quick load never flashes it.
 */
export function LoadingState({ shape = "section" }: { shape?: LoadingShape | undefined }) {
  const quip = useQuip(QUIPS.loading);
  const art = <BeeArt pool="busy" quip={quip} className="motion-safe:animate-hover" />;
  return (
    <div aria-busy="true" className="appear-after-wait">
      {shape === "page" ? (
        <FallbackState role="status" size="page" art={art} title={quip} />
      ) : (
        <EmptyStateFrame role="status" art={art} title={quip} />
      )}
    </div>
  );
}
