/** A row in a DrawerDialog's list (an action, a page): a full-width target for a thumb. */
export const DRAWER_ROW =
  "flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm outline-none select-none hover:bg-muted focus-visible:bg-muted active:bg-muted disabled:pointer-events-none disabled:opacity-50 aria-[current=page]:bg-muted aria-[current=page]:font-medium [&_svg]:size-4 [&_svg]:shrink-0";

/** A line between a DrawerDialog's groups of rows. */
export const DRAWER_SEPARATOR = "mx-3 my-1.5 h-px shrink-0 bg-border";

/** A group's label over its rows. */
export const DRAWER_LABEL = "px-3 pt-1.5 pb-1 text-xs font-medium text-muted-foreground";
