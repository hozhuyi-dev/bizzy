import { createContext, useContext } from "react";
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
