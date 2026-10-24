import { cn } from "cn";
import { RefreshCwIcon } from "lucide-react";
import { useSyncNow } from "./sync-button.hook";
import { Button } from "~/components/ui/button";
import { HintTooltip } from "~/components/shared/feedback/hint-tooltip/hint-tooltip.component";

/**
 * Sits in the wide nav bar, so a failed sync shows on every page (a phone's
 * shows on its menu button, and syncs from the menu). The app already syncs
 * on load and every so often; a click syncs again, to pick up changes made
 * in the calendar since. Each sync reads what changed since the last one,
 * then goes on reading older events while there are some. It says when it
 * last ran in full when wide, a dot for a failure where narrower, and in its
 * tooltip with the error and how far back it has read. Hidden until Google
 * is connected, since there's nothing to sync.
 */
export function SyncButton() {
  const now = useSyncNow();
  if (!now) return null;
  const { sync, running, backfilling, failed, error, label, back } = now;
  const tone = failed ? "text-destructive" : "text-muted-foreground";

  return (
    <HintTooltip
      hint={
        <>
          <span className="font-medium">Sync calendar now</span>
          {label && <span>{label}</span>}
          {error && <span>{error}</span>}
          {back && <span>{back}</span>}
        </>
      }
    >
      <Button
        variant="ghost"
        // Not disabled while it runs, so its tooltip still shows; a click then does nothing.
        aria-disabled={running || undefined}
        className="relative max-xl:size-8 max-xl:px-0"
        aria-label={label ? `Sync calendar now. ${label}` : "Sync calendar now"}
        onClick={sync}
      >
        <RefreshCwIcon className={running || backfilling ? "animate-spin" : undefined} />
        {/* Whole when wide, kept to a width so a long one never pushes the bar. */}
        <span className={cn("hidden max-w-44 truncate xl:inline", tone)}>{label}</span>
        {failed && <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-destructive xl:hidden" />}
      </Button>
    </HintTooltip>
  );
}
