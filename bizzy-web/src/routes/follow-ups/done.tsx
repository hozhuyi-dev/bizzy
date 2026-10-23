import { createFileRoute, redirect } from "@tanstack/react-router";

/** Done follow-ups are the list's Done preset now; an old link lands there. */
export const Route = createFileRoute("/follow-ups/done")({
  beforeLoad: () => {
    throw redirect({ to: "/follow-ups", search: { status: ["done"] }, replace: true });
  },
});
