import type { ReactElement, ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";

interface HintTooltipProps {
  /** Said on hover or focus; nothing shows without one. */
  hint: ReactNode;
  /**
   * The one element it is about, rendered as the trigger. A disabled button
   * gets no hover, so one with a hint is disabled with
   * `focusableWhenDisabled`.
   */
  children: ReactElement;
}

/**
 * A short hint beside an element: why an action can't be taken now, or
 * what a button says in full. A phone has no hover, so what it says must
 * also be said elsewhere there (a line under a menu item, a short label).
 */
export function HintTooltip({ hint, children }: HintTooltipProps) {
  if (!hint) return children;
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent className="flex-col items-start">{hint}</TooltipContent>
    </Tooltip>
  );
}
