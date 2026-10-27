import { Drawer } from "@base-ui/react/drawer";
import { cn } from "cn";
import { XIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "~/components/ui/button";

// The drawer's own easing, so a swipe let go and a tap closing it move alike.
const MOTION =
  "transition-transform duration-[450ms] ease-[cubic-bezier(0.32,0.72,0,1)] data-swiping:select-none data-swiping:duration-0 data-ending-style:duration-[calc(var(--drawer-swipe-strength)*400ms)] motion-reduce:transition-none";

const SIDES = {
  bottom: {
    swipe: "down",
    viewport: "items-end",
    popup: cn(
      "max-h-[85dvh] w-full rounded-t-2xl border-t px-2 pt-2 pb-[max(var(--dock-air),env(safe-area-inset-bottom))]",
      "[transform:translateY(var(--drawer-swipe-movement-y))]",
      "data-starting-style:[transform:translateY(100%)] data-ending-style:[transform:translateY(100%)]",
    ),
  },
  right: {
    swipe: "right",
    viewport: "justify-end",
    popup: cn(
      "h-full w-[min(20rem,85vw)] border-l p-3",
      "[transform:translateX(var(--drawer-swipe-movement-x))]",
      "data-starting-style:[transform:translateX(100%)] data-ending-style:[transform:translateX(100%)]",
    ),
  },
} as const;

interface DrawerDialogProps {
  open: boolean;
  onClose: () => void;
  /** The edge it slides from, and is swiped back to. */
  side: "bottom" | "right";
  /** Its accessible name; shown unless `hideTitle`. */
  title: ReactNode;
  hideTitle?: boolean | undefined;
  children: ReactNode;
}

/**
 * A panel from an edge of a phone's screen, swiped back to close: menus that
 * need more room or bigger targets than a dropdown (the nav's ☰, the dock's
 * ⋯). From the bottom it has a handle to swipe; from the side, a close
 * button, as nothing hints at the swipe.
 */
export function DrawerDialog({
  open,
  onClose,
  side,
  title,
  hideTitle,
  children,
}: DrawerDialogProps) {
  const { swipe, viewport, popup } = SIDES[side];
  return (
    <Drawer.Root
      open={open}
      onOpenChange={(next) => !next && onClose()}
      swipeDirection={swipe}
    >
      <Drawer.Portal>
        <Drawer.Backdrop
          className={cn(
            "fixed inset-0 z-50 min-h-dvh bg-black/20 opacity-[calc(1-var(--drawer-swipe-progress))] dark:bg-black/50",
            "transition-opacity duration-450 ease-[cubic-bezier(0.32,0.72,0,1)] data-swiping:duration-0 data-starting-style:opacity-0 data-ending-style:opacity-0",
            // iOS: covers the whole visible screen, toolbars too.
            "supports-[-webkit-touch-callout:none]:absolute",
          )}
        />
        <Drawer.Viewport className={cn("fixed inset-0 z-50 flex", viewport)}>
          <Drawer.Popup
            className={cn(
              "flex flex-col overflow-y-auto overscroll-contain bg-popover text-sm text-popover-foreground shadow-lg outline-none",
              MOTION,
              popup,
            )}
          >
            {side === "bottom" && (
              <div
                aria-hidden="true"
                className="mx-auto mb-2 h-1 w-10 shrink-0 rounded-full bg-muted-foreground/30"
              />
            )}
            <Drawer.Content className="flex flex-col">
              <div
                className={cn(
                  "flex items-center justify-between gap-2",
                  hideTitle && side === "bottom" && "sr-only",
                )}
              >
                <Drawer.Title
                  className={cn(
                    "px-3 py-1.5 text-xs font-medium text-muted-foreground",
                    hideTitle && "sr-only",
                  )}
                >
                  {title}
                </Drawer.Title>
                {side === "right" && (
                  <Drawer.Close
                    render={
                      <Button
                        variant="ghost"
                        size="icon-lg"
                        className="ml-auto"
                        aria-label="Close"
                      />
                    }
                  >
                    <XIcon />
                  </Drawer.Close>
                )}
              </div>
              {children}
            </Drawer.Content>
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
