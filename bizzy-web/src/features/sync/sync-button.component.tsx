import { RefreshCwIcon } from "lucide-react";
import { toast } from "sonner";
import { SyncMutation, SyncQuery } from "./sync.query";
import type { SyncSummary } from "./sync.types";
import { Button } from "~/components/ui/button";
import { formatRelative } from "~/core/utils/date.util";

function describe(summary: SyncSummary): string {
  const parts = [`${summary.sessions} sessions`];
  if (summary.unmatched) parts.push(`${summary.unmatched} unmatched`);
  if (summary.parseErrors) parts.push(`${summary.parseErrors} to fix`);
  const changes = summary.saved + summary.deleted;
  return `${parts.join(", ")} · ${changes ? `${changes} updated` : "nothing changed"}`;
}

/** Runs the calendar sync now instead of waiting for tonight's. */
export function SyncButton() {
  const status = SyncQuery.useStatus();
  const run = SyncMutation.useRun();

  return (
    <div className="flex items-center gap-2">
      <span className="hidden text-xs text-muted-foreground sm:inline">
        {status.data ? `Synced ${formatRelative(status.data.at)}` : status.isSuccess ? "Never synced" : ""}
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
