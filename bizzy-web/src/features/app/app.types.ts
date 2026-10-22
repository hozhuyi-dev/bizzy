// Mirrors bizzy-lambda/internal/app/status.go.
import type { GoogleConnectionView } from "~/features/google/google.types";
import type { SettingsGapsView } from "~/features/settings/settings.types";
import type { SyncView } from "~/features/sync/sync.types";

/** What every page shows around it, read in one call; mirrors app.StatusView. */
export interface AppStatusView {
  /** Null before the user connects. */
  google: GoogleConnectionView | null;
  gaps: SettingsGapsView;
  /** The last sync; null before the first. */
  sync: SyncView | null;
}
