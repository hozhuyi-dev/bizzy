import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  return createRouter({
    routeTree,
    defaultPreload: "intent",
    defaultErrorComponent: ({ error }) => (
      <p role="alert" className="p-4 text-sm text-destructive">
        {error instanceof Error ? error.message : "Something went wrong."}
      </p>
    ),
    defaultNotFoundComponent: () => (
      <p className="p-4 text-sm text-muted-foreground">Page not found.</p>
    ),
    scrollRestoration: true,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
