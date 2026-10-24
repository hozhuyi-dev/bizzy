import { cn } from "cn";
import { useEffect, useState } from "react";
import { usePageSlots } from "~/components/shared/layout/page-header/page-header.hook";
import { useHeight } from "~/core/scroll-spy/scroll-spy.hook";
import { setDockHeight } from "~/core/scroll-spy/scroll-spy.util";

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
  const [frameRef, height] = useHeight<HTMLDivElement>();
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  useKeyboardInset(element);

  useEffect(() => {
    setDockHeight(height);
    return () => setDockHeight(undefined);
  }, [height]);

  return (
    <div
      ref={(node) => {
        frameRef.current = node;
        setElement(node);
      }}
      className="pointer-events-none fixed inset-x-0 bottom-(--keyboard-inset,0px) z-(--z-dock) flex flex-col items-end gap-1.5 px-2 pt-2 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] has-[[data-slot=page-dock]:empty]:hidden md:hidden"
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

/**
 * Keeps the dock on top of the phone's keyboard: the keyboard shrinks only
 * the visual viewport, and a fixed element sits at the bottom of the layout
 * one, under the keyboard, so it is raised by the difference. Not while
 * zoomed in, when that difference is the zoom's.
 */
function useKeyboardInset(element: HTMLElement | null) {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!element || !viewport) return undefined;
    const update = () => {
      const inset = viewport.scale > 1.01 ? 0 : window.innerHeight - viewport.height - viewport.offsetTop;
      element.style.setProperty("--keyboard-inset", `${Math.max(0, Math.round(inset))}px`);
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, [element]);
}
