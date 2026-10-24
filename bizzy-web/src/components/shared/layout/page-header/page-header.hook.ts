import { createContext, useContext, useSyncExternalStore } from "react";
import type { ReactNode } from "react";

/**
 * A banner every page shows before its own: the app's, about the whole app
 * (setup not finished). Given by the app's root, since PageHeader knows no
 * feature; nothing outside it.
 */
export const AppBannerContext = createContext<ReactNode>(null);

/** The app's banner, for PageHeader to show with the page's. */
export function useAppBanner(): ReactNode {
  return useContext(AppBannerContext);
}

/**
 * Where a phone shows the page header's parts, outside the page: its title
 * in the nav bar, its actions and toolbar in the dock at the bottom, and the
 * toolbar's chips in the tray above the dock. Each is null until it is on
 * screen (PageHeaderTitleSlot, PageDock). `actions` is the wide header's
 * action area, where what takes over the actions (SelectionBar) goes.
 */
export interface PageSlots {
  title: HTMLElement | null;
  dock: HTMLElement | null;
  tray: HTMLElement | null;
  actions: HTMLElement | null;
  setTitle: (element: HTMLElement | null) => void;
  setDock: (element: HTMLElement | null) => void;
  setTray: (element: HTMLElement | null) => void;
  setActions: (element: HTMLElement | null) => void;
}

const none = () => undefined;

export const PageSlotsContext = createContext<PageSlots>({
  title: null,
  dock: null,
  tray: null,
  actions: null,
  setTitle: none,
  setDock: none,
  setTray: none,
  setActions: none,
});

export function usePageSlots(): PageSlots {
  return useContext(PageSlotsContext);
}

/** Whether a toolbar (a FilterBar, a SearchInput) is in a phone's dock, where it lays itself out for it. */
export const DockContext = createContext(false);

export function useInDock(): boolean {
  return useContext(DockContext);
}

// Tailwind's max-md, and app.css's twin of it.
const COMPACT = "(width < 48rem)";

function subscribe(onChange: () => void) {
  const query = window.matchMedia(COMPACT);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/**
 * Whether the screen is a phone's (below md): the page's title in the nav
 * bar, its actions in the dock. A desktop window split in half is still
 * wider, so it keeps the desktop's header.
 */
export function useCompactLayout(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(COMPACT).matches,
    () => false,
  );
}
