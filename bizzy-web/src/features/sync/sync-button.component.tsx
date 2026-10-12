import { useState } from "react";
import { RefreshCwIcon } from "lucide-react";
import { toast } from "sonner";
import { SyncDatesDialog } from "./sync-dates-dialog.component";
import { SyncMutation, SyncQuery } from "./sync.query";
import type { SyncRange, SyncRun, SyncSummary } from "./sync.types";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { GoogleQuery } from "~/features/google/google.query";
import { formatRelative } from "~/core/utils/date.util";

function describe(summary: SyncSummary): string {
  const changes = summary.saved + summary.deleted + summary.followUps + summary.contacts;
  return `${summary.sessions} sessions · ${changes ? `${changes} updated` : "nothing changed"}`;
}

function lastRun(run: SyncRun | null | undefined, running: boolean): string {
  if (running) return "Syncing…";
  if (run === undefined) return "";
  if (run === null) return "Never synced";
  if (run.error) return `Sync failed ${formatRelative(run.at)}`;
  return `Synced ${formatRelative(run.at)}`;
}

/**
 * Sits in the nav bar, so a failed sync shows on every page. The app already
 * syncs the last 60 days on load; the menu syncs again, or dates she picks,
 * to pick up changes made in the calendar since. Hidden until Google is
 * connected, since there's nothing to sync.
 */
export function SyncButton() {
  const google = GoogleQuery.useStatus();
  const status = SyncQuery.useStatus();
  const run = SyncMutation.useRun();
  // Includes the sync on load, which runs outside this button.
  const running = SyncMutation.useIsRunning();
  const [picking, setPicking] = useState(false);

  if (google.data === null) return null;

  const sync = (range?: SyncRange) =>
    run.mutate(range, {
      onSuccess: (summary) => toast.success("Calendar synced", { description: describe(summary) }),
      onError: (error) => toast.error(error.message),
    });

  const failed = !running && Boolean(status.data?.error);
  const label = lastRun(status.data, running);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="sm"
              className="relative max-lg:size-7 max-lg:px-0"
              aria-label={label ? `Calendar sync: ${label}` : "Calendar sync"}
            />
          }
        >
          <RefreshCwIcon className={running ? "animate-spin" : undefined} />
          <span className={failed ? "hidden text-destructive lg:inline" : "hidden text-muted-foreground lg:inline"}>
            {label}
          </span>
          {failed && (
            <span className="absolute top-1 right-1 size-1.5 rounded-full bg-destructive lg:hidden" />
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <div className="px-1.5 py-1 text-xs">
            <p className={failed ? "font-medium text-destructive" : "text-muted-foreground"}>{label}</p>
            {failed && <p className="mt-0.5 text-muted-foreground">{status.data?.error}</p>}
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={running} onClick={() => sync()}>
            Sync now
          </DropdownMenuItem>
          <DropdownMenuItem disabled={running} onClick={() => setPicking(true)}>
            Sync dates…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <SyncDatesDialog
        open={picking}
        onClose={() => setPicking(false)}
        onSync={(range) => {
          setPicking(false);
          sync(range);
        }}
      />
    </>
  );
}
