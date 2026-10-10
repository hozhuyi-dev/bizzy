import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: SessionsRoute,
});

// Becomes the sessions inbox once the sync persists sessions.
function SessionsRoute() {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-lg font-semibold">Sessions</h1>
      <p className="text-sm text-muted-foreground">
        Sessions from the calendar will appear here after the first sync.
      </p>
    </div>
  );
}
