import { useState } from "react";
import { ChevronDownIcon, RefreshCwIcon } from "lucide-react";
import { toast } from "sonner";
import { SyncDatesDialog } from "./sync-dates-dialog.component";
import { SyncMutation, SyncQuery } from "./sync.query";
import type { ReactNode } from "react";
import type { SyncRange, SyncRun, SyncSummary } from "./sync.types";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { formatRelative } from "~/core/utils/date.util";

function describe(summary: SyncSummary): string {
  const changes = summary.saved + summary.deleted + summary.contacts;
  return `${summary.sessions} sessions · ${changes ? `${changes} updated` : "nothing changed"}`;
}

function lastRun(run: SyncRun | null | undefined): ReactNode {
  if (run === undefined) return "";
  if (run === null) return "Never synced";
  if (run.error) {
    return (
      <span className="text-destructive" title={run.error}>
        Sync failed {formatRelative(run.at)}
      </span>
    );
  }
  return `Synced ${formatRelative(run.at)}`;
}

/**
 * Syncs the last 60 days now, or dates she picks. The app already syncs on
 * load; this picks up changes made in the calendar since.
 */
export function SyncButton() {
  const status = SyncQuery.useStatus();
  const run = SyncMutation.useRun();
  // Includes the sync on load, which runs outside this button.
  const running = SyncMutation.useIsRunning();
  const [picking, setPicking] = useState(false);

  const sync = (range?: SyncRange) =>
    run.mutate(range, {
      onSuccess: (summary) => toast.success("Calendar synced", { description: describe(summary) }),
      onError: (error) => toast.error(error.message),
    });

  return (
    <div className="flex items-center gap-2">
      <span className="hidden text-xs text-muted-foreground sm:inline">
        {lastRun(status.data)}
      </span>
      <div className="flex">
        <Button
          variant="outline"
          size="sm"
          className="rounded-r-none"
          disabled={running}
          onClick={() => sync()}
        >
          <RefreshCwIcon className={running ? "animate-spin" : undefined} />
          {running ? "Syncing…" : "Sync now"}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="outline"
                size="icon-sm"
                className="-ml-px rounded-l-none"
                disabled={running}
                aria-label="More sync options"
              />
            }
          >
            <ChevronDownIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setPicking(true)}>Sync dates…</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <SyncDatesDialog
        open={picking}
        onClose={() => setPicking(false)}
        onSync={(range) => {
          setPicking(false);
          sync(range);
        }}
      />
    </div>
  );
}
