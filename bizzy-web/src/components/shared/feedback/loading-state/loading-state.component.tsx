import { useQuip } from "~/components/shared/feedback/quip/quip.hook";
import { QUIPS } from "~/core/constants/quips.constant";

/** Stands in for "Loading…". */
export function LoadingState() {
  const quip = useQuip(QUIPS.loading);
  return (
    <p role="status" className="text-sm text-muted-foreground">
      {quip}
    </p>
  );
}
