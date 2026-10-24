import { Link, useLocation } from "@tanstack/react-router";
import { cn } from "cn";
import { CalendarIcon, LogOutIcon, RefreshCwIcon, SettingsIcon } from "lucide-react";
import type { SyncNow } from "~/features/sync/components/sync-button/sync-button.hook";
import { MODULES } from "~/core/navigation/navigation.constant";
import { moduleOf, pageOf } from "~/core/navigation/navigation.util";
import { Wordmark } from "~/components/shared/layout/logo/logo.component";
import { DrawerDialog } from "~/components/shared/dialog/drawer-dialog/drawer-dialog.component";
import {
  DRAWER_LABEL,
  DRAWER_ROW,
  DRAWER_SEPARATOR,
} from "~/components/shared/dialog/drawer-dialog/drawer-dialog.constant";

interface NavSheetProps {
  open: boolean;
  onClose: () => void;
  /** The calendar's sync, once Google is connected. */
  sync: SyncNow | null;
  onCalendarGuide: () => void;
  onSignOut: () => void;
}

/**
 * Everything the nav bar holds below lg, from the right edge: the modules
 * (a module of several pages as a group of them), then the calendar's sync,
 * which the app runs on its own and is here to run again or see how it
 * went, then the account's. The page open is marked.
 */
export function NavSheet({ open, onClose, sync, onCalendarGuide, onSignOut }: NavSheetProps) {
  const { pathname } = useLocation();
  const current = moduleOf(pathname);
  const page = current && pageOf(current, pathname);
  const settingsActive = pathname.startsWith("/settings");

  return (
    // The bee is in the nav bar beside it; the name says whose menu this is.
    <DrawerDialog open={open} onClose={onClose} side="right" title={<Wordmark />}>
      <nav aria-label="Pages" className="flex flex-col">
        {MODULES.map((module, i) => (
          <div key={module.label} className="flex flex-col">
            {module.pages.length > 1 && (
              <>
                {i > 0 && <div className={DRAWER_SEPARATOR} />}
                <p className={DRAWER_LABEL}>{module.label}</p>
              </>
            )}
            {module.pages.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                // The router marks a link on any path under it current too (Expenses
                // on Items), over aria-current here; pageOf decides instead.
                activeOptions={{ exact: true }}
                aria-current={item === page ? "page" : undefined}
                className={cn(DRAWER_ROW, module.pages.length > 1 && "pl-6")}
                onClick={onClose}
              >
                {module.pages.length > 1 ? item.label : module.label}
              </Link>
            ))}
            {module.pages.length > 1 && i < MODULES.length - 1 && <div className={DRAWER_SEPARATOR} />}
          </div>
        ))}
      </nav>
      <div className={DRAWER_SEPARATOR} />
      {sync && <SyncRow sync={sync} />}
      <Link
        to="/settings"
        aria-current={settingsActive ? "page" : undefined}
        className={DRAWER_ROW}
        onClick={onClose}
      >
        <SettingsIcon className="text-muted-foreground" /> Settings
      </Link>
      <button
        type="button"
        className={DRAWER_ROW}
        onClick={() => {
          onClose();
          onCalendarGuide();
        }}
      >
        <CalendarIcon className="text-muted-foreground" /> Calendar guide
      </button>
      <div className={DRAWER_SEPARATOR} />
      <button type="button" className={DRAWER_ROW} onClick={onSignOut}>
        <LogOutIcon className="text-muted-foreground" /> Sign out
      </button>
    </DrawerDialog>
  );
}

/** Syncs again, and says when it last did; a failure in red, with why. Open while it runs, to watch it. */
function SyncRow({ sync }: { sync: SyncNow }) {
  const { running, backfilling, failed, error, short, back } = sync;
  const detail = error ?? back;
  return (
    <button type="button" className={DRAWER_ROW} aria-disabled={running || undefined} onClick={sync.sync}>
      <RefreshCwIcon
        className={cn(
          failed ? "text-destructive" : "text-muted-foreground",
          (running || backfilling) && "motion-safe:animate-spin",
        )}
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-baseline justify-between gap-2">
          Sync calendar
          {short && (
            <span className={cn("shrink-0 text-xs", failed ? "text-destructive" : "text-muted-foreground")}>{short}</span>
          )}
        </span>
        {detail && <span className={cn("text-xs", failed ? "text-destructive" : "text-muted-foreground")}>{detail}</span>}
      </span>
    </button>
  );
}
