import { useEffect, useRef } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { GoogleMutation } from "~/features/google/google.query";
import { googleRedirectUri, takeGoogleState } from "~/features/google/google.oauth";
import { SyncMutation } from "~/features/sync/sync.query";

export interface GoogleCallbackSearch {
  code?: string | undefined;
  state?: string | undefined;
  error?: string | undefined;
}

const text = (value: unknown) => (typeof value === "string" ? value : undefined);

// Google sends her back here from the consent screen (see google.oauth).
export const Route = createFileRoute("/google-callback")({
  validateSearch: (search: Record<string, unknown>): GoogleCallbackSearch => ({
    code: text(search.code),
    state: text(search.state),
    error: text(search.error),
  }),
  component: GoogleCallback,
});

function GoogleCallback() {
  const { code, state, error } = Route.useSearch();
  const navigate = useNavigate();
  // Async throughout: plain mutate() callbacks are dropped if the page
  // unmounts first, and the sync outlives it.
  const { mutateAsync: connect } = GoogleMutation.useConnect();
  const { mutateAsync: sync } = SyncMutation.useRun();
  // The code works once; StrictMode runs effects twice in development.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const done = () => void navigate({ to: "/settings", replace: true });
    const expected = takeGoogleState();

    if (error) {
      toast.error(error === "access_denied" ? "Google wasn't connected." : `Google said: ${error}`);
      done();
      return;
    }
    if (!code || !state || state !== expected) {
      toast.error("That sign-in couldn't be verified. Please connect again.");
      done();
      return;
    }

    connect({ code, redirectUri: googleRedirectUri() })
      .then((connection) => {
        toast.success(`Connected ${connection.email}`, { description: `Syncing ${connection.calendarName}…` });
        sync({ all: true }).catch((syncError: Error) => toast.error(syncError.message));
      })
      .catch((connectError: Error) => toast.error(connectError.message))
      .finally(done);
  }, [code, state, error, connect, sync, navigate]);

  return <p className="p-4 text-sm text-muted-foreground">Connecting Google…</p>;
}
