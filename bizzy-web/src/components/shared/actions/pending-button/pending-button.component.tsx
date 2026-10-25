import { cn } from "cn";
import { LoaderCircleIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { Button } from "~/components/ui/button";

type PendingButtonProps = ComponentProps<typeof Button> & {
  /** While what it started is under way: it can't be pressed again. */
  pending?: boolean | undefined;
};

/**
 * Every button that waits on what it started (Save, Delete, Try again):
 * while it waits, its label stays, hidden, so it keeps its width, and a
 * spinner turns in its middle. It isn't faded as a disabled one is: it
 * is busy, not unavailable.
 */
export function PendingButton({ pending = false, disabled, className, children, ...props }: PendingButtonProps) {
  return (
    <Button
      {...props}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      data-pending={pending || undefined}
      className={cn("relative", pending && "disabled:opacity-100", className)}
    >
      {/* The label's gap is the button's, so wrapping it changes nothing. */}
      <span className={cn("inline-flex min-w-0 items-center justify-center gap-[inherit]", pending && "invisible")}>
        {children}
      </span>
      {pending && <LoaderCircleIcon aria-hidden="true" className="absolute inset-0 m-auto motion-safe:animate-spin" />}
    </Button>
  );
}
