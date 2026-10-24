import { cn } from "cn";
import { useEffect } from "react";
import { usePageSlots } from "~/components/shared/layout/page-header/page-header.hook";
import { useHeight } from "~/core/scroll-spy/scroll-spy.hook";
import { setDockHeight } from "~/core/scroll-spy/scroll-spy.util";
import { useKeyboardInset } from "~/core/viewport/keyboard-inset.hook";

// The dock and its tray: frosted panels floating over the page.
const PANEL =
  "pointer-events-auto rounded-2xl border bg-background/85 shadow-lg backdrop-blur-md empty:hidden dark:bg-background/75";

/**
 * A phone's page actions, floating at the bottom within a thumb's reach. The
 * page header puts what moves around the list at its left (the way back and
 * the pager, or a list's filter) and its actions at its right (the main one
 * last, at the edge), so each stays in one place from page to page. With the
 * first it spans the screen; with only actions it hugs them on the right.
 * Above it, the tray holds what narrows the list (a FilterBar's chips), so a
 * filtered list says so however far it is scrolled. Hidden while it holds
 * nothing. It rides above the keyboard while one is up, so Save stays in
 * reach while typing. Its height, the tray's and the air around them is
 * --dock-height: the room left under the page, and the toasts' place.
 */
export function PageDock() {
  const { setDock, setTray } = usePageSlots();
  const [frameRef, height, frame] = useHeight<HTMLDivElement>();
  useKeyboardInset(frame);

  useEffect(() => {
    setDockHeight(height);
    return () => setDockHeight(undefined);
  }, [height]);

  return (
    <div
      ref={frameRef}
      // Lifted over the keyboard by translate, which moves it without laying the page out again.
      className="pointer-events-none fixed inset-x-0 bottom-0 z-(--z-dock) flex -translate-y-(--keyboard-inset) flex-col items-end gap-1.5 px-2 pt-2 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] has-[[data-slot=page-dock]:empty]:hidden md:hidden"
    >
      <div ref={setTray} data-slot="page-dock-tray" className={cn(PANEL, "w-full px-1 py-1")} />
      <div
        ref={setDock}
        data-slot="page-dock"
        className={cn(PANEL, "group/dock flex max-w-full min-w-0 items-center gap-1 p-1 has-data-dock-start:w-full")}
      />
    </div>
  );
}
