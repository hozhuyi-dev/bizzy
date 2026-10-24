import { toast } from "sonner";
import { useSyncCalendar } from "../../sync.hook";
import { SyncMutation } from "../../sync.mutation";
import { SyncQuery } from "../../sync.query";
import { backText, describeSync, lastRunText, shortRunText } from "../../sync.util";
import { GoogleQuery } from "~/features/google/google.query";
import { toastRefusal } from "~/features/remedies/components/remedy-buttons/remedy-buttons.component";

export interface SyncNow {
  /** Syncs again, unless one is running; says how it went in a toast. */
  sync: () => void;
  /** A sync, or reading older events after one (which also spins). */
  running: boolean;
  backfilling: boolean;
  /** The last sync failed, and none is running. */
  failed: boolean;
  error: string | undefined;
  /** When it last ran, in full and short. */
  label: string;
  short: string;
  /** How far back it has read, while it goes on reading. */
  back: string;
}

/**
 * The calendar's sync, for the buttons that run it again and say how the
 * last went (the wide nav bar's, the phone's menu). Null until Google is
 * connected, since there's nothing to sync. Its state includes the sync on
 * load, which runs outside them.
 */
export function useSyncNow(): SyncNow | null {
  const google = GoogleQuery.useStatus();
  const status = SyncQuery.useStatus();
  const syncCalendar = useSyncCalendar();
  const running = SyncMutation.useIsRunning();
  const backfilling = SyncMutation.useIsBackfilling();

  if (google.data === null) return null;

  const failed = !running && Boolean(status.data?.error);
  return {
    sync: () => {
      if (running) return;
      syncCalendar()
        .then((result) => toast.success("Calendar synced", { description: describeSync(result) }))
        .catch(toastRefusal);
    },
    running,
    backfilling,
    failed,
    error: failed ? (status.data?.error ?? undefined) : undefined,
    label: lastRunText(status.data, running, backfilling),
    short: shortRunText(status.data, running, backfilling),
    back: failed ? "" : backText(status.data),
  };
}
