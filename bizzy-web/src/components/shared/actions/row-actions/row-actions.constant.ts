/**
 * A row's buttons: on a phone every control a touch target high (--touch-target), those with words
 * sharing the row, icon-only ones (with an aria-label) square. For any row
 * of things to do (a timeline's item too), so buttons are one size.
 */
export const ROW_ACTIONS = [
  "flex items-center gap-1.5 sm:shrink-0 sm:justify-end",
  "max-sm:[&_[data-slot=button]]:h-(--touch-target) max-sm:[&_[data-slot=dropdown-menu-trigger]]:h-(--touch-target) max-sm:[&_[data-slot=input]]:h-(--touch-target)",
  "max-sm:[&>[data-slot=button]:not([aria-label])]:flex-1 max-sm:[&>[data-slot=dropdown-menu-trigger]:not([aria-label])]:flex-1",
  "max-sm:[&_[aria-label][data-slot=button]]:min-w-(--touch-target) max-sm:[&_[aria-label][data-slot=dropdown-menu-trigger]]:min-w-(--touch-target)",
].join(" ");
