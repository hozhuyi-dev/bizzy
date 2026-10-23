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
}
