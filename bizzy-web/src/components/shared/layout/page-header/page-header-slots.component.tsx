import { useMemo, useState } from "react";
import { PageSlotsContext, usePageSlots } from "./page-header.hook";
import type { ReactNode } from "react";

/** Holds where a phone shows the page header's parts (see PageSlots), for the app's root. */
export function PageHeaderSlotsProvider({ children }: { children: ReactNode }) {
  const [title, setTitle] = useState<HTMLElement | null>(null);
  const [dock, setDock] = useState<HTMLElement | null>(null);
  const [tray, setTray] = useState<HTMLElement | null>(null);
  const [actions, setActions] = useState<HTMLElement | null>(null);
  const slots = useMemo(
    () => ({ title, dock, tray, actions, setTitle, setDock, setTray, setActions }),
    [title, dock, tray, actions],
  );
  return <PageSlotsContext value={slots}>{children}</PageSlotsContext>;
}

/**
 * Where a phone's nav bar shows the page's title: the way back (or the bee,
 * home) and the title with a line under it. Empty while no page header is
 * up, so the nav bar can show its logo instead (`peer-empty`).
 */
export function PageHeaderTitleSlot({ className }: { className?: string | undefined }) {
  const { setTitle } = usePageSlots();
  return <div ref={setTitle} className={className} />;
}
