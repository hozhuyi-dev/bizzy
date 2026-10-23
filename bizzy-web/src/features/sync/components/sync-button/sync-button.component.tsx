import { cn } from "cn";
import { RefreshCwIcon } from "lucide-react";
import { toast } from "sonner";
import { useSyncCalendar } from "../../sync.hook";
import { SyncMutation } from "../../sync.mutation";
import { SyncQuery } from "../../sync.query";
import { backText, describeSync, lastRunText, shortRunText } from "../../sync.util";
import { Button } from "~/components/ui/button";
import { HintTooltip } from "~/components/shared/feedback/hint-tooltip/hint-tooltip.component";
import { GoogleQuery } from "~/features/google/google.query";
import { toastRefusal } from "~/features/remedies/components/remedy-buttons/remedy-buttons.component";

/**
 * Sits in the nav bar, so a failed sync shows on every page. The app
 * already syncs on load; a click syncs again, to pick up changes made in
 * the calendar since. Each sync reads what changed since the last one,
 * then goes on reading older events while there are some. It says when it
 * last ran: short on a phone, in full on a wide screen, and in its tooltip
 * with the error and how far back it has read. Hidden until Google is
 * connected, since there's nothing to sync.
 */
export function SyncButton() {
  const google = GoogleQuery.useStatus();
  const status = SyncQuery.useStatus();
  const syncCalendar = useSyncCalendar();
  // Includes the sync on load, which runs outside this button.
  const running = SyncMutation.useIsRunning();
  const backfilling = SyncMutation.useIsBackfilling();

  if (google.data === null) return null;

  const sync = () => {
    if (running) return;
    syncCalendar()
      .then((result) => toast.success("Calendar synced", { description: describeSync(result) }))
      .catch(toastRefusal);
  };

  const failed = !running && Boolean(status.data?.error);
  const label = lastRunText(status.data, running, backfilling);
  const short = shortRunText(status.data, running, backfilling);
  const back = failed ? "" : backText(status.data);
  const tone = failed ? "text-destructive" : "text-muted-foreground";

  return (
    <HintTooltip
      hint={
        <>
          <span className="font-medium">Sync calendar now</span>
          {label && <span>{label}</span>}
          {failed && <span>{status.data?.error}</span>}
          {back && <span>{back}</span>}
        </>
      }
    >
      <Button
        variant="ghost"
        // Not disabled while it runs, so its tooltip still shows; a click then does nothing.
        aria-disabled={running || undefined}
        className="relative lg:max-xl:size-8 lg:max-xl:px-0"
        aria-label={label ? `Sync calendar now. ${label}` : "Sync calendar now"}
        onClick={sync}
      >
        <RefreshCwIcon className={running || backfilling ? "animate-spin" : undefined} />
        {/* Short on a phone, where the bar has room; none beside the module links; whole when wide, kept to a width so a long one never pushes the bar. */}
        <span className={cn("lg:hidden", tone)}>{short}</span>
        <span className={cn("hidden max-w-44 truncate xl:inline", tone)}>{label}</span>
        {failed && (
          <span className="absolute top-1.5 right-1.5 hidden size-1.5 rounded-full bg-destructive lg:max-xl:block" />
        )}
      </Button>
    </HintTooltip>
  );
}
