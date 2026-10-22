import { cn } from "cn";
import { RefreshCwIcon } from "lucide-react";
import { toast } from "sonner";
import { useSyncCalendar } from "../../sync.hook";
import { SyncMutation } from "../../sync.mutation";
import { SyncQuery } from "../../sync.query";
import { backText, describeSync, lastRunText } from "../../sync.util";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { GoogleQuery } from "~/features/google/google.query";
import { toastRefusal } from "~/features/remedies/components/remedy-buttons/remedy-buttons.component";

/**
 * Sits in the nav bar, so a failed sync shows on every page. The app
 * already syncs on load; the menu syncs again, to pick up changes made in
 * the calendar since. Each sync reads what changed since the last one,
 * then goes on reading older events while there are some. Hidden until
 * Google is connected, since there's nothing to sync.
 */
export function SyncButton() {
  const google = GoogleQuery.useStatus();
  const status = SyncQuery.useStatus();
  const syncCalendar = useSyncCalendar();
  // Includes the sync on load, which runs outside this button.
  const running = SyncMutation.useIsRunning();
  const backfilling = SyncMutation.useIsBackfilling();

  if (google.data === null) return null;

  const sync = () =>
    syncCalendar()
      .then((result) => toast.success("Calendar synced", { description: describeSync(result) }))
      .catch(toastRefusal);

  const failed = !running && Boolean(status.data?.error);
  const label = lastRunText(status.data, running, backfilling);
  const back = failed ? "" : backText(status.data);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            className="relative max-xl:size-8 max-xl:px-0"
            aria-label={label ? `Calendar sync: ${label}` : "Calendar sync"}
          />
        }
      >
        <RefreshCwIcon className={running || backfilling ? "animate-spin" : undefined} />
        {/* Kept to a width, so a long one ("Reading older events…") never pushes the bar; the menu says it whole. */}
        <span className={cn("hidden max-w-44 truncate xl:inline", failed ? "text-destructive" : "text-muted-foreground")}>
          {label}
        </span>
        {failed && <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-destructive xl:hidden" />}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <div className="px-1.5 py-1 text-xs">
          <p className={failed ? "font-medium text-destructive" : "text-muted-foreground"}>{label}</p>
          {failed && <p className="mt-0.5 text-muted-foreground">{status.data?.error}</p>}
          {back && <p className="mt-0.5 text-muted-foreground">{back}</p>}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={running} onClick={sync}>
          Sync now
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
