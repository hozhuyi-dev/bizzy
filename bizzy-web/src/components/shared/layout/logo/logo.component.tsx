import { cn } from "cn";

/**
 * The Bizzy bee, drawn in lines only. Strokes use currentColor, so the colour
 * comes from a text token (text-brand) and follows the theme. Kept in step
 * with public/favicon.svg.
 */
export function BeeMark({ className }: { className?: string | undefined }) {
  return (
    <svg
      // Cropped to the drawing (and its stroke), so the bee fills its box.
      viewBox="6.4 4 23.2 23.2"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn("size-6 shrink-0 text-brand", className)}
    >
      {/* Wings */}
      <path d="M17.5 12.1C13.5 11.5 12.5 6 15.3 5.6C17.9 5.2 18.5 9 17.5 12.1Z" />
      <path d="M20 12.4C20.5 8.1 23.5 5.6 25.7 6.9C27.9 8.2 25 11.7 20 12.4Z" />
      {/* Body, stripes and stinger */}
      <ellipse cx="17" cy="19" rx="9" ry="7" />
      <path d="M20 12.4Q21.5 19 20 25.6" />
      <path d="M23.5 14.2Q24.6 19 23.5 23.8" />
      <path d="M26 19h2.5" />
      {/* Antennae */}
      <path d="M11.5 13.5Q10.5 10.6 8 9.8" />
      <path d="M13.8 12.5Q13.4 9.8 11 8.6" />
      {/* Eye and smile */}
      <path d="M12 17.6h0" />
      <path d="M11.2 20.6q1.1 .9 2.2 0" />
    </svg>
  );
}

/** The Bizzy name alone: beside the bee, or where the bee is already (a phone's menu). */
export function Wordmark({ className }: { className?: string | undefined }) {
  return (
    <span className={cn("text-lg leading-none font-semibold tracking-tight text-brand-strong", className)}>Bizzy</span>
  );
}

/** The bee with the Bizzy wordmark, for the nav bar and the sign-in card. */
export function Logo({ className }: { className?: string | undefined }) {
  return (
    <span className={cn("inline-flex items-center gap-2 text-lg leading-none", className)}>
      <BeeMark className="size-7" />
      <Wordmark />
    </span>
  );
}
