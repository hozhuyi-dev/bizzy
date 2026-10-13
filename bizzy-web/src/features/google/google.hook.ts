import { useEffect, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { GoogleMutation } from "./google.mutation";
import { GoogleOAuthService } from "./google-oauth.service";
import type { GoogleCallbackSearch } from "./google.types";
import { SyncMutation } from "~/features/sync/sync.mutation";

/** Sends her to Google's consent screen; she comes back to /google-callback. */
export function useGoogleConsent(): () => void {
  return GoogleOAuthService.startConsent;
}

/**
 * Finishes connecting on /google-callback: checks the state, trades the code,
 * syncs the whole calendar, then goes back to Settings.
 */
export function useFinishGoogleConsent({ code, state, error }: GoogleCallbackSearch): void {
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
    const expected = GoogleOAuthService.takeState();

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

    connect({ code, redirectUri: GoogleOAuthService.redirectUri() })
      .then((connection) => {
        toast.success(`Connected ${connection.email}`, { description: `Syncing ${connection.calendarName}…` });
        sync({ all: true }).catch((syncError: Error) => toast.error(syncError.message));
      })
      .catch((connectError: Error) => toast.error(connectError.message))
      .finally(done);
  }, [code, state, error, connect, sync, navigate]);
}
