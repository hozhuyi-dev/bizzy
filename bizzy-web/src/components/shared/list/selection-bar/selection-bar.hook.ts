import { createContext, useContext } from "react";
import { useCompactLayout, usePageSlots } from "~/components/shared/layout/page-header/page-header.hook";

/**
 * Where a section keeps its actions on a wide screen (beside its heading,
 * PageSections): a SelectionBar inside the section goes there instead of
 * the page header's, as what is ticked is the section's. Undefined outside
 * one, null until the heading is on screen.
 */
export const SelectionSlotContext = createContext<HTMLElement | null | undefined>(undefined);

/**
 * Where what is ticked (or the hint to tick) shows: the dock on a phone;
 * on a wide screen the section's heading for a section's list, else the
 * page header's action area. Null until that is on screen.
 */
export function useSelectionTarget() {
  const slots = usePageSlots();
  const compact = useCompactLayout();
  const section = useContext(SelectionSlotContext);
  const inSection = !compact && section !== undefined;
  const target = compact ? slots.dock : inSection ? section : slots.actions;
  return { target, compact, inSection };
}
