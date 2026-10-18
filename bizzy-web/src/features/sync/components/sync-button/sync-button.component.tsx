import { RefreshCwIcon } from "lucide-react";
import { toast } from "sonner";
import { SyncMutation } from "../../sync.mutation";
import { SyncQuery } from "../../sync.query";
import { describeSync, lastRunText } from "../../sync.util";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { GoogleQuery } from "~/features/google/google.query";

/**
 * Sits in the nav bar, so a failed sync shows on every page. The app
 * already syncs on load; the menu syncs again, to pick up changes made in
 * the calendar since. Each sync reads what changed since the last one.
 * Hidden until Google is connected, since there's nothing to sync.
 */
export function SyncButton() {
  const google = GoogleQuery.useStatus();
  const status = SyncQuery.useStatus();
  const run = SyncMutation.useRun();
  // Includes the sync on load, which runs outside this button.
  const running = SyncMutation.useIsRunning();

  if (google.data === null) return null;

  const sync = () =>
    run.mutate(undefined, {
      onSuccess: (result) => toast.success("Calendar synced", { description: describeSync(result) }),
      onError: (error) => toast.error(error.message),
    });

  const failed = !running && Boolean(status.data?.error);
  const label = lastRunText(status.data, running);

  return (
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
        {failed && <span className="absolute top-1 right-1 size-1.5 rounded-full bg-destructive lg:hidden" />}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <div className="px-1.5 py-1 text-xs">
          <p className={failed ? "font-medium text-destructive" : "text-muted-foreground"}>{label}</p>
          {failed && <p className="mt-0.5 text-muted-foreground">{status.data?.error}</p>}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={running} onClick={sync}>
          Sync now
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
