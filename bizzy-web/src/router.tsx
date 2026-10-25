import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { ErrorPage } from "~/components/shared/feedback/error-page/error-page.component";
import { NotFoundPage } from "~/components/shared/feedback/not-found-page/not-found-page.component";
import { pageShown } from "~/core/utils/page-data.util";

export function getRouter() {
  const router = createRouter({
    routeTree,
    defaultPreload: "intent",
    // No pending component: a page whose loader reads its data (pageData)
    // keeps the one being left on screen until it is ready.
    defaultErrorComponent: ErrorPage,
    defaultNotFoundComponent: () => <NotFoundPage />,
    scrollRestoration: true,
  });
  const stop = router.subscribe("onResolved", () => {
    pageShown();
    stop();
  });
  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
  interface StaticDataRouteOption {
    /** Open to anyone, without signing in or the app around it (share links). */
    public?: boolean;
  }
  /**
   * What a page is opened with by the page that opens it, kept in the
   * browser's history rather than the URL: Back, Forward and a reload keep
   * it, a link to the page doesn't carry it. Only for the way there (what a
   * new item starts with, where to look first); what a link should name is
   * in the URL. A page works without it, as when opened from a link.
   */
  interface HistoryState {
    /** The client a new follow-up, package or session is for. */
    clientId?: string | undefined;
    /** The session a new follow-up is made from. */
    sessionId?: string | undefined;
    /** The session a new one is booked after: its next visit, with the same client, length and place. */
    after?: string | undefined;
    /** Where the new session's page goes back to, once it has one. */
    from?: "home" | "today" | undefined;
    /** A package opened to pay for it: its payment comes into view. */
    at?: "payment" | undefined;
    /** The calendar edit the page was opened to settle (a remedy's second step): once saved, back to the to-do list (useSettleReturn). */
    settle?: string | undefined;
    /** What a new client is called, to start with: the unmatched name in the calendar. */
    name?: string | undefined;
  }
}
