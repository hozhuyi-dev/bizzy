import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { CopyIcon, RotateCwIcon } from "lucide-react";
import { toast } from "sonner";
import type { LinkOptions } from "@tanstack/react-router";
import type { FallbackSize } from "~/components/shared/feedback/fallback-state/fallback-state.component";
import { BeeArt } from "~/components/shared/feedback/bee-art/bee-art.component";
import { FallbackState } from "~/components/shared/feedback/fallback-state/fallback-state.component";
import { NotFoundPage } from "~/components/shared/feedback/not-found-page/not-found-page.component";
import { Button } from "~/components/ui/button";
import { PendingButton } from "~/components/shared/actions/pending-button/pending-button.component";
import { isApiError } from "~/core/utils/api-error.util";
import { errorDetails } from "~/core/utils/error-details.util";

interface ErrorStateProps {
  error: unknown;
  /** Reads it again (a query's refetch); without one, Try again reloads the page. */
  retry?: (() => unknown) | undefined;
  /** A whole page's body, or one part of it (a table's body, a section). */
  size?: FallbackSize | undefined;
  /** What didn't load, as the title says it: "This page didn't load". */
  title?: string | undefined;
  /** Where to go instead of an item that isn't there: its list. */
  back?: { label: string; link: LinkOptions } | undefined;
}

/**
 * In place of what didn't load, shaped like the not-found page: a bee
 * drawing in red (a cracked cell, a spilled jar, a dizzy bee; one adrift
 * when offline), what happened, then what to do next. Try again first; if it keeps happening,
 * the details to copy and send to the developer. An item that isn't there
 * (deleted, or a link gone stale) is said like the not-found page, with
 * the way back to its list.
 */
export function ErrorState({ error, retry, size = "section", title, back }: ErrorStateProps) {
  if (isApiError(error, "not_found")) return <NotFoundPage message={error.message} back={back} size={size} />;
  const backButton = back && (
    <Button variant="ghost" size="sm" render={<Link {...back.link} />} nativeButton={false}>
      {back.label}
    </Button>
  );

  const offline = typeof navigator !== "undefined" && !navigator.onLine;
  return (
    <FallbackState
      role="alert"
      size={size}
      tone="error"
      art={<BeeArt key={offline ? "offline" : "broken"} pool={offline ? "offline" : "broken"} />}
      title={offline ? "You're offline" : (title ?? (size === "page" ? "This page didn't load" : "This didn't load"))}
      actions={
        <>
          <RetryButton retry={retry} />
          <Button variant="ghost" size="sm" onClick={() => void copyDetails(error)}>
            <CopyIcon />
            Copy details
          </Button>
          {backButton}
        </>
      }
    >
      <p>{offline ? "Try again once you're back online." : messageOf(error)}</p>
      <p>If it keeps happening, copy the details and send them to the developer.</p>
    </FallbackState>
  );
}

/** Tries again, and says so until the read is back (it stays here if it fails again). */
function RetryButton({ retry }: { retry: (() => unknown) | undefined }) {
  const [trying, setTrying] = useState(false);
  return (
    <PendingButton
      variant="outline"
      size="sm"
      pending={trying}
      onClick={() => {
        if (!retry) {
          window.location.reload();
          return;
        }
        setTrying(true);
        void Promise.resolve(retry()).finally(() => setTrying(false));
      }}
    >
      <RotateCwIcon />
      Try again
    </PendingButton>
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "Something went wrong.";
}

async function copyDetails(error: unknown) {
  try {
    await navigator.clipboard.writeText(errorDetails(error, window.location.href, new Date()));
    toast.success("Details copied", { description: "Paste them in a message to the developer." });
  } catch {
    toast.error("Couldn't copy the details");
  }
}
