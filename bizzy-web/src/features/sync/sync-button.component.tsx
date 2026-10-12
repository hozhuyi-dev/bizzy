import { RefreshCwIcon } from "lucide-react";
import { toast } from "sonner";
import { SyncMutation, SyncQuery } from "./sync.query";
import type { ReactNode } from "react";
import type { SyncRun, SyncSummary } from "./sync.types";
import { Button } from "~/components/ui/button";
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

/** Runs the calendar sync now instead of waiting for tonight's. */
export function SyncButton() {
  const status = SyncQuery.useStatus();
  const run = SyncMutation.useRun();

  return (
    <div className="flex items-center gap-2">
      <span className="hidden text-xs text-muted-foreground sm:inline">
        {lastRun(status.data)}
      </span>
      <Button
        variant="outline"
        size="sm"
        disabled={run.isPending}
        onClick={() =>
          run.mutate(undefined, {
            onSuccess: (summary) => toast.success("Calendar synced", { description: describe(summary) }),
            onError: (error) => toast.error(error.message),
          })
        }
      >
        <RefreshCwIcon className={run.isPending ? "animate-spin" : undefined} />
        {run.isPending ? "Syncing…" : "Sync now"}
      </Button>
    </div>
  );
}
