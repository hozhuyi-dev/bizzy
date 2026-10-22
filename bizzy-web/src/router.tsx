import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { NotFoundPage } from "~/components/shared/feedback/not-found-page/not-found-page.component";

export function getRouter() {
  return createRouter({
    routeTree,
    defaultPreload: "intent",
    defaultErrorComponent: ({ error }) => (
      <p role="alert" className="p-4 text-sm text-destructive">
        {error instanceof Error ? error.message : "Something went wrong."}
      </p>
    ),
    defaultNotFoundComponent: NotFoundPage,
    scrollRestoration: true,
  });
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
