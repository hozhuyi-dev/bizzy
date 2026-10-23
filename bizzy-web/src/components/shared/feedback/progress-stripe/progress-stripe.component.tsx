import { cn } from "cn";

/**
 * A stripe sliding along an edge while what is shown is being read again:
 * the nav bar's while the next page loads, a table's while its rows do.
 * Shown only after --wait-delay, so a quick read never flashes it. Place
 * it with `className`; it takes no room of its own. Neutral, like the
 * rest of the UI: honey is the logo's.
 */
export function ProgressStripe({ label, className }: { label: string; className?: string | undefined }) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      className={cn("pointer-events-none h-0.5 appear-after-wait overflow-hidden", className)}
    >
      <div className="h-full w-1/3 bg-muted-foreground motion-safe:animate-slide motion-reduce:w-full motion-reduce:opacity-60" />
    </div>
  );
}
